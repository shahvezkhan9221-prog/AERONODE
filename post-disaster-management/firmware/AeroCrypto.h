#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include "mbedtls/gcm.h"

// Binary LoRa envelope:
// magic(2) | version(1) | flags(1) | senderId(4) | counter(8) |
// ciphertextLength(1) | ciphertext(0..222) | GCM tag(16)

enum class AeroDecryptResult {
  Ok,
  InvalidFormat,
  AuthenticationFailed,
  ReplayRejected,
  OutputTooSmall,
};

class AeroCrypto {
 public:
  static constexpr size_t kHeaderBytes = 17;
  static constexpr size_t kTagBytes = 16;
  static constexpr size_t kMaxPlaintextBytes = 222;

  AeroCrypto(const uint8_t key[32], uint32_t nodeId) : nodeId_(nodeId) {
    memcpy(key_, key, sizeof(key_));
    mbedtls_gcm_init(&gcm_);
  }

  bool begin() {
    if (nodeId_ == 0 || keyIsEmpty()) return false;
    if (mbedtls_gcm_setkey(&gcm_, MBEDTLS_CIPHER_ID_AES, key_, 256) != 0) return false;

    // Reserve a large counter block in NVS once per boot. This avoids flash wear
    // on every packet while preventing nonce reuse after an ordinary reboot.
    Preferences preferences;
    if (!preferences.begin("aero-crypto", false)) return false;
    uint64_t reservedStart = preferences.getULong64("next-tx", 1);
    constexpr uint64_t kCountersPerBoot = 1000000ULL;
    if (reservedStart > 0xFFFFFFFFFFFFFFFFULL - kCountersPerBoot) {
      preferences.end();
      return false;
    }
    size_t written = preferences.putULong64("next-tx", reservedStart + kCountersPerBoot);
    preferences.end();
    if (written != sizeof(uint64_t)) return false;
    nextCounter_ = reservedStart;
    counterLimit_ = reservedStart + kCountersPerBoot;
    ready_ = true;
    return true;
  }

  bool encrypt(const uint8_t* plaintext, size_t plaintextLength,
               uint8_t* frame, size_t frameCapacity, size_t& frameLength) {
    frameLength = 0;
    if (!ready_ || !plaintext || !frame || plaintextLength > kMaxPlaintextBytes ||
        frameCapacity < kHeaderBytes + plaintextLength + kTagBytes || nextCounter_ >= counterLimit_) return false;

    frame[0] = 'A';
    frame[1] = 'N';
    frame[2] = 1;
    frame[3] = 0;
    write32(frame + 4, nodeId_);
    write64(frame + 8, nextCounter_++);
    frame[16] = static_cast<uint8_t>(plaintextLength);

    const uint8_t* nonce = frame + 4; // senderId + persistent counter = 96-bit nonce
    uint8_t* ciphertext = frame + kHeaderBytes;
    uint8_t* tag = ciphertext + plaintextLength;
    int result = mbedtls_gcm_crypt_and_tag(
      &gcm_, MBEDTLS_GCM_ENCRYPT, plaintextLength,
      nonce, 12, frame, kHeaderBytes,
      plaintext, ciphertext, kTagBytes, tag
    );
    if (result != 0) return false;
    frameLength = kHeaderBytes + plaintextLength + kTagBytes;
    return true;
  }

  AeroDecryptResult decrypt(const uint8_t* frame, size_t frameLength,
                            uint8_t* plaintext, size_t plaintextCapacity, size_t& plaintextLength) {
    plaintextLength = 0;
    if (!ready_ || !frame || !plaintext || frameLength < kHeaderBytes + kTagBytes ||
        frame[0] != 'A' || frame[1] != 'N' || frame[2] != 1 || frame[3] != 0) {
      return AeroDecryptResult::InvalidFormat;
    }
    size_t ciphertextLength = frame[16];
    if (ciphertextLength > kMaxPlaintextBytes || frameLength != kHeaderBytes + ciphertextLength + kTagBytes) {
      return AeroDecryptResult::InvalidFormat;
    }
    if (plaintextCapacity < ciphertextLength + 1) return AeroDecryptResult::OutputTooSmall;

    uint32_t senderId = read32(frame + 4);
    uint64_t counter = read64(frame + 8);
    if (senderId == 0 || senderId == nodeId_ || counter == 0 || isReplay(senderId, counter)) {
      return AeroDecryptResult::ReplayRejected;
    }

    const uint8_t* ciphertext = frame + kHeaderBytes;
    const uint8_t* tag = ciphertext + ciphertextLength;
    int result = mbedtls_gcm_auth_decrypt(
      &gcm_, ciphertextLength, frame + 4, 12,
      frame, kHeaderBytes, tag, kTagBytes,
      ciphertext, plaintext
    );
    if (result != 0) {
      memset(plaintext, 0, plaintextCapacity);
      return AeroDecryptResult::AuthenticationFailed;
    }
    rememberCounter(senderId, counter);
    plaintext[ciphertextLength] = 0;
    plaintextLength = ciphertextLength;
    return AeroDecryptResult::Ok;
  }

 private:
  struct ReplayEntry { uint32_t senderId = 0; uint64_t highestCounter = 0; };
  mbedtls_gcm_context gcm_;
  uint8_t key_[32] = {};
  uint32_t nodeId_ = 0;
  uint64_t nextCounter_ = 0;
  uint64_t counterLimit_ = 0;
  bool ready_ = false;
  ReplayEntry replay_[12];
  size_t replayReplacement_ = 0;

  bool keyIsEmpty() const {
    uint8_t combined = 0;
    for (uint8_t byte : key_) combined |= byte;
    return combined == 0;
  }

  bool isReplay(uint32_t senderId, uint64_t counter) const {
    for (const ReplayEntry& entry : replay_) {
      if (entry.senderId == senderId) return counter <= entry.highestCounter;
    }
    return false;
  }

  void rememberCounter(uint32_t senderId, uint64_t counter) {
    for (ReplayEntry& entry : replay_) {
      if (entry.senderId == senderId) { entry.highestCounter = counter; return; }
      if (entry.senderId == 0) { entry.senderId = senderId; entry.highestCounter = counter; return; }
    }
    replay_[replayReplacement_] = { senderId, counter };
    replayReplacement_ = (replayReplacement_ + 1) % 12;
  }

  static void write32(uint8_t* output, uint32_t value) {
    for (int i = 0; i < 4; i++) output[i] = static_cast<uint8_t>(value >> (i * 8));
  }

  static void write64(uint8_t* output, uint64_t value) {
    for (int i = 0; i < 8; i++) output[i] = static_cast<uint8_t>(value >> (i * 8));
  }

  static uint32_t read32(const uint8_t* input) {
    uint32_t value = 0;
    for (int i = 0; i < 4; i++) value |= uint32_t(input[i]) << (i * 8);
    return value;
  }

  static uint64_t read64(const uint8_t* input) {
    uint64_t value = 0;
    for (int i = 0; i < 8; i++) value |= uint64_t(input[i]) << (i * 8);
    return value;
  }
};
