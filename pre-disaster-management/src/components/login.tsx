"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Radio,
  ShieldCheck,
  LoaderCircle,
  Activity,
  Waves,
} from "lucide-react";
import Brand from "./brand";
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(demo = false) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, demo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection failed. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <header className="login-header">
        <Brand />
        <span className="hackathon-label">
          <span className="tiny-dot" /> SMART INDIA HACKATHON 2026
        </span>
      </header>
      <div className="login-scene" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="orbit orbit-three" />
        <span className="scene-node scene-node-one">
          <Activity size={18} />
          <span>
            NODE 01<small>Seismic monitoring</small>
          </span>
          <i className="status-dot" />
        </span>
        <span className="scene-node scene-node-two">
          <Waves size={18} />
          <span>
            NODE 02<small>Flood & water level</small>
          </span>
          <i className="status-dot" />
        </span>
      </div>
      <section className="login-card neo">
        <div className="login-icon">
          <ShieldCheck size={28} strokeWidth={1.5} />
        </div>
        <div className="eyebrow">OPERATOR ACCESS</div>
        <h1>Welcome to Sentinel.</h1>
        <p className="login-description">
          Your network. A clearer picture.
          <br />
          Sign in to your monitoring workspace.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <label htmlFor="email">Email address</label>
          <div className="input-wrap">
            <Mail size={17} />
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="operator@sentinel.mesh"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <label htmlFor="password">Password</label>
          <div className="input-wrap">
            <LockKeyhole size={17} />
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="icon-button"
              aria-label={show ? "Hide password" : "Show password"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <div className="login-form-note">
            <ShieldCheck size={13} /> Single-operator monitoring workspace
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="button primary login-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <>
                Sign in to dashboard <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <div className="or-divider">
          <span /> OR EXPLORE THE NETWORK <span />
        </div>
        <button
          className="button demo-entry"
          onClick={() => login(true)}
          disabled={busy}
        >
          <Radio size={17} /> Enter simulation demo <ArrowRight size={16} />
        </button>
        <p className="demo-credentials">
          Demo: <b>operator@sentinel.mesh</b> / <b>sentinel2026</b>
        </p>
      </section>
      <div className="login-bottom">
        <span>
          <span className="status-dot" /> Resilient by design. Connected by
          direct USB.
        </span>
        <span>
          2 serial ports <i /> 2 sensor nodes <i /> Rule-based fusion
        </span>
      </div>
      <footer className="login-footer">
        <span>© 2026 SENTINEL-MESH</span>
        <span>
          SIH26178 <span className="footer-dot">·</span> Disaster Management{" "}
          <span className="footer-dot">·</span> Prototype v1.0
        </span>
      </footer>
    </main>
  );
}
