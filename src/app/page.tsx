"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Banknote, Check, ChevronRight, CircleCheck, Coins, House, ImagePlus, Leaf, LoaderCircle, LogOut, MapPin, Recycle, ScanLine, ShieldCheck, UserRound, Wallet, X } from "lucide-react";
import { messages } from "@/lib/i18n";
import { pickup } from "@/config";

type Screen = "welcome" | "phone" | "otp" | "home" | "profile" | "scan" | "verifying" | "result" | "wallet" | "payout" | "confirm" | "success";
type Method = "ABA" | "ACLEDA" | "VISA";
type Scan = { id: string; cans: number; bottles: number; points: number; kg: number; status: string };
type Activity = { id: string; kind: "SCAN" | "CASHOUT"; cans?: number; bottles?: number; points?: number; amount?: number; status: string; reason?: string | null; method?: string; createdAt: string };
type Payout = { id: string; amount: number; method: string; status: string; providerRef?: string | null };
type PickupAddress = { recipientName: string; contactPhone: string; addressLine: string; khan: string; sangkat: string; landmark: string };
const emptyPickupAddress: PickupAddress = { recipientName: "", contactPhone: "", addressLine: "", khan: "", sangkat: "", landmark: "" };
const MINIMUM = 5000;
const money = (value: number) => new Intl.NumberFormat("en-US").format(value);

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [lang, setLang] = useState<"km" | "en">("km");
  const t = messages[lang];
  const [slide, setSlide] = useState(0);
  const [phoneDigits, setPhoneDigits] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resend, setResend] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [balance, setBalance] = useState(0);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [accountIdentity, setAccountIdentity] = useState("");
  const [pickupAddress, setPickupAddress] = useState<PickupAddress>(emptyPickupAddress);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [photo, setPhoto] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [result, setResult] = useState<Scan | null>(null);
  const [verifier, setVerifier] = useState("");
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<Method>("ABA");
  const [account, setAccount] = useState("");
  const [payout, setPayout] = useState<Payout | null>(null);
  const [savedMethod, setSavedMethod] = useState<{ method: Method; account: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const amount = Number(amountText.replace(/\D/g, "")) || 0;
  const progress = Math.min(100, balance / MINIMUM * 100);

  const refresh = useCallback(async () => {
    try {
      const [meResponse, activityResponse] = await Promise.all([fetch("/api/me"), fetch("/api/scans")]);
      if (!meResponse.ok || !activityResponse.ok) { setIsSignedIn(false); return false; }
      const me: { balance: number; user: { phone: string | null; email: string | null }; pickupAddress: PickupAddress } = await meResponse.json();
      const recent: { activity: Activity[] } = await activityResponse.json();
      setBalance(me.balance);
      setAccountIdentity(me.user.email ?? me.user.phone ?? "");
      setPickupAddress({
        ...me.pickupAddress,
        contactPhone: me.pickupAddress.contactPhone.replace(/^\+855/, ""),
      });
      setActivity(recent.activity);
      setIsSignedIn(true);
      return true;
    } catch {
      setError(messages.en.offline);
      return false;
    }
  }, []);

  useEffect(() => { void refresh().then((signedIn) => { if (signedIn) setScreen("home"); }); }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");
    if (!authError) return;
    setError(authError === "google_not_configured" ? t.googleConfigError : t.googleFailure);
    window.history.replaceState(null, "", window.location.pathname);
  }, [t.googleConfigError, t.googleFailure]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (screen !== "welcome") return;
    const timer = window.setTimeout(() => setSlide((value) => (value + 1) % 3), 5000);
    return () => window.clearTimeout(timer);
  }, [screen, slide]);
  useEffect(() => {
    if (screen !== "otp") return;
    const timer = window.setInterval(() => setResend((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen]);

  function changeScreen(next: Screen) { setError(""); setScreen(next); }
  function normalizedPhone() { return `+855${phoneDigits.replace(/^0/, "")}`; }
  function activityStatus(status: string) {
    if (status === "APPROVED") return t.approved;
    if (status === "REJECTED") return t.rejected;
    if (status === "PENDING") return t.pending;
    if (status === "PAID") return t.paid;
    return t.processing;
  }

  async function requestCode() {
    const nextPhone = normalizedPhone();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/request-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: nextPhone }) });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Check the phone number and try again.");
      setPhone(nextPhone); setCode(""); setResend(60); setScreen("otp");
      window.setTimeout(() => otpRef.current?.focus(), 100);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send the code. Check your number and try again."); }
    finally { setBusy(false); }
  }

  async function verifyCode(value = code) {
    if (value.length !== 6) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code: value }) });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "That code is incorrect. Request a new code and try again.");
      await refresh(); setScreen("home");
    } catch (cause) { setCode(""); setError(cause instanceof Error ? cause.message : "Could not sign in. Request a new code and try again."); }
    finally { setBusy(false); }
  }

  async function preparePhoto(file: File) {
    setBusy(true); setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser can’t prepare the photo. Try another image.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not prepare the photo. Try again.")), "image/jpeg", 0.76));
      setImage(new File([blob], "recycling-photo.jpg", { type: "image/jpeg" }));
      setPhoto(URL.createObjectURL(blob));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare the photo. Choose another image and try again."); }
    finally { setBusy(false); }
  }

  async function submitScan() {
    if (!image) { setError("Take or choose a photo before submitting."); return; }
    setBusy(true); setError(""); setScreen("verifying");
    try {
      const form = new FormData(); form.set("image", image);
      const response = await fetch("/api/scans", { method: "POST", body: form });
      const data: { scan?: Scan; verifier?: string; error?: string } = await response.json();
      if (!response.ok || !data.scan) throw new Error(data.error ?? "Photo verification failed. Try a clearer photo.");
      setResult(data.scan); setVerifier(data.verifier ?? ""); await refresh(); setScreen("result");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Photo verification failed. Please try another photo."); setScreen("scan"); }
    finally { setBusy(false); }
  }

  async function cashout() {
    if (!savedMethod) { setError(t.payoutMethod); setScreen("payout"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, method: savedMethod.method, account: savedMethod.account }) });
      const data: { payout?: Payout; error?: string } = await response.json();
      if (!response.ok || !data.payout) throw new Error(data.error ?? "The payout could not be completed. Check the details and try again.");
      setPayout(data.payout); await refresh(); setScreen("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The payout could not be completed. Check the details and try again."); setScreen("confirm"); }
    finally { setBusy(false); }
  }

  async function savePickupAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true); setError(""); setProfileNotice("");
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: pickup.city,
          ...pickupAddress,
          contactPhone: `+855${pickupAddress.contactPhone.replace(/\D/g, "")}`,
        }),
      });
      const data: { error?: string; pickupAddress?: PickupAddress } = await response.json();
      if (!response.ok || !data.pickupAddress) throw new Error(data.error ?? "Could not save the pickup address. Check the details and try again.");
      setPickupAddress({ ...data.pickupAddress, contactPhone: data.pickupAddress.contactPhone.replace(/^\+855/, "") });
      setProfileNotice(t.addressSaved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the pickup address. Check the details and try again.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function logout() {
    setProfileSaving(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not log out. Check your connection and try again.");
      setIsSignedIn(false); setBalance(0); setActivity([]); setAccountIdentity("");
      setPickupAddress(emptyPickupAddress); setProfileNotice(""); setScreen("welcome");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not log out. Check your connection and try again.");
    } finally {
      setProfileSaving(false);
    }
  }

  function resetPhoto() { if (photo) URL.revokeObjectURL(photo); setPhoto(""); setImage(null); setResult(null); setError(""); setScreen("scan"); }

  return <main className="app-shell" lang={lang}>
    <div className="app-phone">
      {screen !== "welcome" && <header className="app-header">
        <button className="back-button" onClick={() => { setError(""); if (screen === "home" || screen === "wallet") { setProfileNotice(""); setScreen("profile"); } else setScreen(screen === "otp" ? "phone" : screen === "phone" ? "welcome" : screen === "payout" ? "wallet" : screen === "confirm" ? "wallet" : "home"); }} aria-label={screen === "home" || screen === "wallet" ? t.profile : "Back"}>{screen === "home" || screen === "wallet" ? <UserRound size={20}/> : <ArrowLeft size={20}/>}</button>
        <span className="header-brand"><span className="brand-icon"><Recycle size={17}/></span>VilChum</span>
        <button className="language-button" onClick={() => setLang(lang === "km" ? "en" : "km")}>{lang === "km" ? "EN" : "ខ្មែរ"}</button>
      </header>}
      {!online && <div className="offline-banner">{t.offline}</div>}

      {screen === "welcome" && <section className={`welcome-screen ${slide === 0 ? "welcome-sky" : ""}`}>
        <div className="welcome-top"><span className="wordmark">VilChum</span><button className="language-button" onClick={() => setLang(lang === "km" ? "en" : "km")}>{lang === "km" ? "EN" : "ខ្មែរ"}</button></div>
        <div className="story-progress" aria-label={`Story ${slide + 1} of 3`}>{[0, 1, 2].map((index) => <span key={index} className="story-track"><i key={`${slide}-${index}`} className={index < slide ? "complete" : index === slide ? "current" : ""}/></span>)}</div>
        <div className="story-content" onClick={(event) => setSlide((value) => Math.max(0, Math.min(2, value + (event.clientX < window.innerWidth / 2 ? -1 : 1))))}>
          <div className="story-copy"><h1>{slide === 0 ? t.tagline : slide === 1 ? t.slide2 : t.slide3}</h1><p>{slide === 0 ? t.onePoint : slide === 1 ? t.slide2sub : t.slide3sub}</p></div>
          {slide === 0 ? <div className="story-visual"><div className="sun-disc"><Leaf size={52} strokeWidth={1.4}/></div><div className="points-chip"><Coins size={19}/><strong>+45 pts</strong></div></div>
            : slide === 1 ? <div className="story-visual price-list"><div className="price-row"><span className="price-mark"><Recycle size={18}/></span><span>{t.aluminium}</span><strong>3,000៛ <small>/ {t.perKg}</small></strong></div><div className="price-row"><span className="price-mark"><Recycle size={18}/></span><span>{t.plastic}</span><strong>1,000៛ <small>/ {t.perKg}</small></strong></div></div>
              : <div className="story-visual bank-list">{(["ABA", "ACLEDA", "Visa"] as const).map((name) => <div className="bank-wordmark" key={name}>{name}</div>)}</div>}
          <div className="story-hit-hint">{slide + 1} / 3</div>
        </div>
        <div className="welcome-actions"><button className="button mint-button" onClick={(event) => { event.stopPropagation(); changeScreen("phone"); }}>{t.phoneStart}<ArrowRight size={18}/></button><a className="button text-button" href="/api/auth/google">{t.googleLogin}<ArrowRight size={16}/></a><button className="button text-button" onClick={() => setError(t.coming)}>{t.emailLogin} <span>{t.coming}</span></button>{error && <p className="coming-message">{error}</p>}</div>
      </section>}

      {screen === "phone" && <section className="auth-content">
        <div className="step-progress"><i className="active"/><i/></div><div className="auth-icon"><ShieldCheck size={25}/></div>
        <h1 className="page-title">{t.phoneTitle}</h1><p className="page-subtitle">{t.phoneSub}</p>
        <label className="field-label">{t.phoneLabel}</label><div className="phone-input"><span className="country-code">+855</span><input className="text-field" autoFocus inputMode="tel" autoComplete="tel-national" placeholder="12 345 678" value={phoneDigits} onChange={(event) => setPhoneDigits(event.target.value.replace(/\D/g, "").slice(0, 9))}/></div>
        {error && <div className="error-message">{error}</div>}<button className="button gold-button full-button" disabled={busy || phoneDigits.replace(/^0/, "").length < 8} onClick={() => void requestCode()}>{busy ? <LoaderCircle className="spin" size={18}/> : t.continue}<ArrowRight size={18}/></button>
      </section>}

      {screen === "otp" && <section className="auth-content">
        <div className="step-progress"><i className="active"/><i className="active"/></div><div className="auth-icon"><ShieldCheck size={25}/></div>
        <h1 className="page-title">{t.otpTitle}</h1><p className="page-subtitle">{t.otpSub} <strong>{phone}</strong></p>
        <label className="field-label">{t.otpLabel}</label><div className="otp-display" onClick={() => otpRef.current?.focus()}>{[0, 1, 2, 3, 4, 5].map((index) => <span className={`otp-cell ${index === code.length ? "focused" : ""}`} key={index}>{code[index] ?? ""}</span>)}</div>
        <input ref={otpRef} className="otp-hidden-input" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(0, 6); setCode(value); setError(""); if (value.length === 6) void verifyCode(value); }}/>
        {process.env.NODE_ENV === "development" && <p className="demo-code">{t.demoCode}</p>}
        {error && <div className="error-message">{error}</div>}<button className="button gold-button full-button" disabled={busy || code.length !== 6} onClick={() => void verifyCode()}>{busy ? <LoaderCircle className="spin" size={18}/> : t.verify}<ArrowRight size={18}/></button>
        <button className="resend-button" disabled={resend > 0 || busy} onClick={() => void requestCode()}>{resend > 0 ? `${t.resendIn} 0:${String(resend).padStart(2, "0")}` : t.resend}</button>
      </section>}

      {screen === "profile" && <section className="profile-content">
        <p className="eyebrow">{t.profile}</p><h1 className="page-title">{t.profileTitle}</h1>
        <div className="profile-account"><UserRound size={20}/><span>{accountIdentity}</span></div>
        <div className="profile-section-heading"><div><h2>{t.pickupAddress}</h2><p>{t.addressIntro}</p></div><MapPin size={21}/></div>
        <form className="profile-form" onSubmit={(event) => void savePickupAddress(event)}>
          <div className="pickup-area"><span>{t.pickupArea}</span><strong>{pickup.city}</strong></div>
          <label className="field-label" htmlFor="recipient-name">{t.recipientName}</label>
          <input id="recipient-name" className="text-field" autoComplete="name" maxLength={80} required value={pickupAddress.recipientName} onChange={(event) => setPickupAddress({ ...pickupAddress, recipientName: event.target.value })}/>
          <label className="field-label" htmlFor="pickup-phone">{t.pickupPhone}</label>
          <div className="phone-input"><span className="country-code">+855</span><input id="pickup-phone" className="text-field" inputMode="tel" autoComplete="tel-national" minLength={8} maxLength={9} pattern="[0-9]{8,9}" required placeholder="12 345 678" value={pickupAddress.contactPhone} onChange={(event) => setPickupAddress({ ...pickupAddress, contactPhone: event.target.value.replace(/\D/g, "").slice(0, 9) })}/></div>
          <label className="field-label" htmlFor="pickup-address">{t.houseStreet}</label>
          <input id="pickup-address" className="text-field" autoComplete="street-address" maxLength={180} required value={pickupAddress.addressLine} onChange={(event) => setPickupAddress({ ...pickupAddress, addressLine: event.target.value })}/>
          <label className="field-label" htmlFor="pickup-khan">{t.khan}</label>
          <select id="pickup-khan" className="text-field" required value={pickupAddress.khan} onChange={(event) => setPickupAddress({ ...pickupAddress, khan: event.target.value })}>
            <option value="">{t.selectKhan}</option>{pickup.khans.map((khan) => <option key={khan} value={khan}>{khan}</option>)}
          </select>
          <label className="field-label" htmlFor="pickup-sangkat">{t.sangkat}</label>
          <input id="pickup-sangkat" className="text-field" maxLength={90} required value={pickupAddress.sangkat} onChange={(event) => setPickupAddress({ ...pickupAddress, sangkat: event.target.value })}/>
          <label className="field-label" htmlFor="pickup-landmark">{t.landmark}</label>
          <input id="pickup-landmark" className="text-field" maxLength={160} value={pickupAddress.landmark} onChange={(event) => setPickupAddress({ ...pickupAddress, landmark: event.target.value })}/>
          {profileNotice && <div className="profile-success"><Check size={16}/>{profileNotice}</div>}
          {error && <div className="error-message">{error}</div>}
          <button className="button gold-button full-button" type="submit" disabled={profileSaving}>{profileSaving ? <LoaderCircle className="spin" size={18}/> : <Check size={18}/>} {t.saveAddress}</button>
        </form>
        <button className="button outline-button profile-logout" disabled={profileSaving} onClick={() => void logout()}>{profileSaving ? <LoaderCircle className="spin" size={18}/> : <LogOut size={18}/>} {profileSaving ? t.signingOut : t.signOut}</button>
      </section>}

      {screen === "home" && <section className="home-content">
        <div className="home-greeting"><div><p className="eyebrow">{t.hello}</p><h1 className="home-title">{t.homeSub}</h1></div><button className="language-button" onClick={() => setLang(lang === "km" ? "en" : "km")}>{lang === "km" ? "EN" : "ខ្មែរ"}</button></div>
        <section className="wallet-balance-card"><div className="balance-caption">{t.balance}</div><div className="balance-total">{money(balance)}<span>៛</span></div><div className="balance-caption balance-goal">{t.cashoutGoal}<span>{Math.floor(progress)}%</span></div><div className="balance-track"><span style={{ width: `${progress}%` }}/></div><div className="balance-note">{money(balance)}៛ = {money(balance)} pts</div></section>
        <div className="home-actions"><button className="button gold-button" onClick={() => { resetPhoto(); }}><ScanLine size={19}/>{t.scan}</button><button className="button outline-button" onClick={() => { setAmountText(balance >= MINIMUM ? String(MINIMUM) : ""); changeScreen("wallet"); }}><Wallet size={19}/>{t.cashout}</button></div>
        <div className="section-heading"><h2>{t.recent}</h2><button className="refresh-button" onClick={() => void refresh()}>{t.refresh}</button></div>
        <div className="activity-list">{activity.length === 0 ? <div className="empty-state"><span className="empty-icon"><Recycle size={24}/></span><p>{t.empty}</p></div> : activity.map((item) => <article className="activity-row" key={item.id}><span className="activity-icon">{item.kind === "SCAN" ? <Recycle size={19}/> : <Banknote size={19}/>}</span><span className="activity-copy"><strong>{item.kind === "SCAN" ? `${item.cans ?? 0} ${t.cans} · ${item.bottles ?? 0} ${t.bottles}` : `${t.cashout} · ${item.method}`}</strong><small>{new Date(item.createdAt).toLocaleDateString(lang === "km" ? "km-KH" : "en-US", { month: "short", day: "numeric" })} · {activityStatus(item.status)}</small></span><b className={item.kind === "SCAN" && (item.points ?? 0) > 0 ? "positive-amount" : "negative-amount"}>{item.kind === "SCAN" ? (item.status === "REJECTED" ? "—" : "+") : "−"}{item.kind === "SCAN" && item.status === "REJECTED" ? "" : `${money(item.kind === "SCAN" ? item.points ?? 0 : item.amount ?? 0)}៛`}</b></article>)}</div>
      </section>}

      {screen === "scan" && <section className="scan-content"><div className="scan-heading"><span className="eyebrow">{t.scan}</span><button className="close-button" onClick={() => changeScreen("home")} aria-label="Close"><X size={20}/></button></div><h1 className="page-title">{photo ? t.review : t.startScanning}</h1><p className="page-subtitle">{photo ? t.review : t.photoHint}</p>
        <div className={`camera-preview ${photo ? "photo-preview" : ""}`}>{photo ? <img src={photo} alt="Recycling items for verification"/> : <div className="camera-frame"><span className="corner top-left"/><span className="corner top-right"/><span className="corner bottom-left"/><span className="corner bottom-right"/><div className="frame-message"><span className="frame-icon"><Recycle size={29}/></span><strong>{t.cans} &amp; {t.bottles}</strong></div></div>}</div>
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void preparePhoto(file); }}/><input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void preparePhoto(file); }}/>
        {!photo ? <div className="scan-controls"><button className="button outline-button" disabled={busy} onClick={() => cameraRef.current?.click()}><ScanLine size={19}/>{busy ? "…" : t.camera}</button><button className="button outline-button" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={19}/>{t.gallery}</button></div> : <div className="scan-controls"><button className="button outline-button" disabled={busy} onClick={() => { resetPhoto(); window.setTimeout(() => cameraRef.current?.click(), 0); }}>{t.retake}</button><button className="button gold-button" disabled={busy} onClick={() => void submitScan()}>{t.submit}<ArrowRight size={17}/></button></div>}
        {error && <div className="error-message">{error}</div>}<p className="scan-limit-note">{t.dailyLimit}</p>
      </section>}

      {screen === "verifying" && <section className="status-screen"><span className="large-spinner"/><h1>{t.checking}</h1></section>}

      {screen === "result" && result && <section className="result-content"><div className="result-check"><CircleCheck size={27}/></div><h1 className="page-title">{t.result}</h1><p className="page-subtitle">{t.approved}</p>
        <div className="result-card"><div className="result-counts"><div><small>{t.cans}</small><strong>{result.cans}</strong></div><div><small>{t.bottles}</small><strong>{result.bottles}</strong></div></div><div className="result-line"><span>{t.weight}</span><strong>{result.kg.toFixed(3)} kg</strong></div><div className="result-line"><span>{t.rate}</span><strong>3,000 / 1,000៛ / kg</strong></div><div className="result-points"><span>{t.pointsEarned}</span><strong>+{money(result.points)}៛</strong></div></div>
        {verifier === "MOCK" && <p className="mock-label">{t.verifierMock}</p>}{error && <div className="error-message">{error}</div>}<button className="button gold-button full-button" onClick={() => changeScreen("home")}>{t.claim}<ArrowRight size={18}/></button>
      </section>}

      {screen === "wallet" && <section className="wallet-content"><p className="eyebrow">{t.wallet}</p><h1 className="wallet-number">{money(balance)}<span> pts</span></h1><p className="wallet-sub">= {money(balance)}៛ · 1 pt = 1៛ · {t.minimum}</p>
        <label className="field-label">{t.amount}</label><input className="text-field amount-field" inputMode="numeric" placeholder={t.enterAmount} value={amountText} onChange={(event) => setAmountText(event.target.value.replace(/\D/g, ""))}/><div className="amount-chips">{[5000, 10000, balance].filter((value, index, list) => value >= MINIMUM && value <= balance && list.indexOf(value) === index).map((value) => <button key={value} className={`amount-chip ${amount === value ? "selected" : ""}`} onClick={() => setAmountText(String(value))}>{money(value)}៛</button>)}</div>
        {balance < MINIMUM && <p className="notice-text">{t.needMore} {money(MINIMUM - balance)}៛ {t.moreBefore}</p>}
        <div className="receive-summary"><span>{t.available}</span><strong>{money(amount)}៛</strong></div><button className="payout-choice" onClick={() => { setMethod(savedMethod?.method ?? "ABA"); setAccount(savedMethod?.account ?? ""); changeScreen("payout"); }}><span className="method-mark">{savedMethod?.method ?? "ABA"}</span><span>{savedMethod ? `${savedMethod.method} ··${savedMethod.account.slice(-4)}` : t.payoutMethod}</span><ChevronRight size={19}/></button>
        {error && <div className="error-message">{error}</div>}<div className="wallet-footer"><button className="button gold-button full-button" disabled={amount < MINIMUM || amount > balance || !savedMethod} onClick={() => { if (!savedMethod) { changeScreen("payout"); return; } changeScreen("confirm"); }}>{t.cashout}<ArrowRight size={18}/></button></div>
      </section>}

      {screen === "payout" && <section className="sheet-backdrop"><div className="bottom-sheet"><div className="sheet-grabber"/><p className="eyebrow">{t.wallet}</p><h1 className="page-title">{t.payoutMethod}</h1><p className="page-subtitle">{t.choosePayout}</p>
        <div className="method-options">{(["ABA", "ACLEDA", "VISA"] as const).map((value) => <button key={value} className={`method-option ${method === value ? "selected" : ""}`} onClick={() => setMethod(value)}><span className="method-mark">{value === "VISA" ? "Visa" : value}</span><span>{value === "VISA" ? "Visa card" : `${value} account`}</span>{method === value && <Check className="method-check" size={18}/>}</button>)}</div>
        <label className="field-label">{t.account}</label><input className="text-field account-field" inputMode="numeric" placeholder={t.accountHint} value={account} onChange={(event) => setAccount(event.target.value.replace(/[^0-9 -]/g, "").slice(0, 32))}/>{error && <div className="error-message">{error}</div>}
        <button className="button gold-button full-button" disabled={account.replace(/\D/g, "").length < 6} onClick={() => { setSavedMethod({ method, account }); setError(""); setScreen("wallet"); }}>{t.saveContinue}<ArrowRight size={18}/></button><p className="sandbox-note">{t.sandbox}</p>
      </div></section>}

      {screen === "confirm" && <section className="sheet-backdrop"><div className="bottom-sheet"><div className="sheet-grabber"/><p className="eyebrow">{t.wallet}</p><h1 className="page-title">{t.confirm}</h1><p className="page-subtitle">{t.reviewPayout}</p><div className="confirm-card"><div><span>{t.amountLabel}</span><strong>{money(amount)}៛</strong></div><div><span>{t.method}</span><strong>{savedMethod?.method}</strong></div><div><span>{t.accountLast}</span><strong>··{savedMethod?.account.slice(-4)}</strong></div></div>{error && <div className="error-message">{error}</div>}<button className="button gold-button full-button" disabled={busy} onClick={() => void cashout()}>{busy ? <LoaderCircle className="spin" size={18}/> : t.send}<ArrowRight size={18}/></button><p className="sandbox-note">{t.sandbox}</p></div></section>}

      {screen === "success" && <section className="status-screen success-screen"><span className="success-mark"><Check size={32}/></span><h1>{t.payoutSuccess}</h1><p>{money(payout?.amount ?? amount)}៛ · {payout?.method ?? savedMethod?.method}</p><div className="confirm-card success-card"><div><span>{t.status}</span><strong className="status-paid">{payout?.status ?? "PROCESSING"}</strong></div><div><span>{t.reference}</span><strong>{payout?.providerRef ?? "—"}</strong></div></div><button className="button gold-button full-button" onClick={() => changeScreen("home")}>{t.done}<ArrowRight size={18}/></button></section>}
    </div>

    {isSignedIn && ["home", "wallet"].includes(screen) && <nav className="floating-tabs"><button className={`tab-item ${screen === "home" ? "active" : ""}`} onClick={() => changeScreen("home")}><House size={21}/><span>{t.home}</span></button><button className="scan-fab" onClick={() => { setPhoto(""); setImage(null); changeScreen("scan"); }} aria-label={t.scan}><ScanLine size={23}/></button><button className={`tab-item ${screen === "wallet" ? "active" : ""}`} onClick={() => { setAmountText(balance >= MINIMUM ? String(MINIMUM) : ""); changeScreen("wallet"); }}><Wallet size={21}/><span>{t.wallet}</span></button></nav>}
  </main>;
}
