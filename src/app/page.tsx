"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Banknote, Check, ChevronRight, CircleCheck, Coins, House, ImagePlus, Leaf, LoaderCircle, LogOut, MapPin, ReceiptText, Recycle, ScanLine, ShieldCheck, UserRound, Wallet, X } from "lucide-react";
import { messages } from "@/lib/i18n";
import { pickup } from "@/config";
import { MIN_CASHOUT, POINTS_PER_ITEM, cashoutQuote, usdLabel } from "@/lib/money";
import { EstimatorUnavailableError, uploadImageForEstimate, type ScanEstimate } from "@/lib/estimate-client";

type Screen = "welcome" | "phone" | "otp" | "home" | "profile" | "scan" | "verifying" | "result" | "wallet" | "payout" | "confirm" | "success";
type Method = "ABA" | "ACLEDA" | "VISA";
type ReceiptKind = "SCAN_VERIFIED" | "CASHOUT_REQUESTED" | "CASHOUT_PAID" | "CASHOUT_REFUNDED";
type Receipt = { id: string; number: string; kind: ReceiptKind; amount: number; delta: number; balanceAfter: number; refId: string; details: Record<string, unknown>; createdAt: string };
type Scan = ScanEstimate;
type Activity = { id: string; kind: "SCAN" | "CASHOUT"; cans?: number; bottles?: number; estimatedPoints?: number; verifiedPoints?: number | null; verifiedCans?: number | null; verifiedBottles?: number | null; amount?: number; status: string; reason?: string | null; method?: string; createdAt: string; receipts: Receipt[] };
type Payout = { id: string; amount: number; method: string; status: string };
type PickupAddress = { recipientName: string; contactPhone: string; addressLine: string; khan: string; sangkat: string; landmark: string };
const emptyPickupAddress: PickupAddress = { recipientName: "", contactPhone: "", addressLine: "", khan: "", sangkat: "", landmark: "" };
const MINIMUM = MIN_CASHOUT;
const money = (value: number) => new Intl.NumberFormat("en-US").format(value);
const detail = (receipt: Receipt, key: string) => receipt.details[key];

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
  const [estimatorBusy, setEstimatorBusy] = useState(false);
  const [retakeOf, setRetakeOf] = useState<string | null>(null);
  const [verifier, setVerifier] = useState("");
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<Method>("ABA");
  const [account, setAccount] = useState("");
  const [payout, setPayout] = useState<Payout | null>(null);
  const [payoutReceipt, setPayoutReceipt] = useState<Receipt | null>(null);
  const [pendingEstimate, setPendingEstimate] = useState(0);
  const [khrPerUsd, setKhrPerUsd] = useState<number | null>(null);
  const [openItem, setOpenItem] = useState<Activity | null>(null);
  const [savedMethod, setSavedMethod] = useState<{ method: Method; account: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const amount = Number(amountText.replace(/\D/g, "")) || 0;
  const progress = Math.min(100, balance / MINIMUM * 100);
  const quote = cashoutQuote(amount);
  // D2: USD is a secondary display label only; it is hidden whenever the live rate is unavailable.
  const usd = (khr: number) => usdLabel(khr, khrPerUsd);

  const refresh = useCallback(async () => {
    try {
      const [meResponse, activityResponse] = await Promise.all([fetch("/api/me"), fetch("/api/scans")]);
      if (!meResponse.ok || !activityResponse.ok) { setIsSignedIn(false); return false; }
      const me: { balance: number; pendingEstimate: number; user: { phone: string | null; email: string | null }; pickupAddress: PickupAddress } = await meResponse.json();
      const recent: { activity: Activity[] } = await activityResponse.json();
      setBalance(me.balance);
      setPendingEstimate(me.pendingEstimate);
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
    fetch("/api/fx").then((response) => response.ok ? response.json() : { khrPerUsd: null })
      .then((data: { khrPerUsd: number | null }) => setKhrPerUsd(data.khrPerUsd))
      .catch(() => setKhrPerUsd(null));
  }, []);
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
    if (status === "VERIFIED") return t.approved;
    if (status === "REJECTED") return t.rejected;
    if (status === "ESTIMATED") return t.pending;
    if (status === "PAID") return t.paid;
    if (status === "FAILED") return t.failed;
    return t.processing;
  }
  function activityAmount(item: Activity) {
    if (item.kind === "CASHOUT" && item.status === "FAILED") return { text: `${money(item.amount ?? 0)}៛`, tone: "negative-amount refunded-amount" };
    if (item.kind === "CASHOUT") return { text: `−${money(item.amount ?? 0)}៛`, tone: "negative-amount" };
    if (item.status === "VERIFIED") return { text: `+${money(item.verifiedPoints ?? 0)}៛`, tone: "positive-amount" };
    if (item.status === "ESTIMATED") return { text: `≈ +${money(item.estimatedPoints ?? 0)}៛`, tone: "estimate-amount" };
    return { text: "—", tone: "negative-amount" };
  }
  function receiptLines(receipt: Receipt): [string, string][] {
    const method = String(detail(receipt, "method") ?? "");
    const last4 = String(detail(receipt, "accountLast4") ?? "");
    if (receipt.kind === "SCAN_VERIFIED") return [
      [`${t.counted} · ${t.cans}`, String(detail(receipt, "cans") ?? 0)],
      [`${t.counted} · ${t.bottles}`, String(detail(receipt, "bottles") ?? 0)],
      [t.estimatedLabel, `≈ ${money(Number(detail(receipt, "estimatedPoints") ?? 0))}៛`],
    ];
    if (receipt.kind === "CASHOUT_REQUESTED") return [[t.fee, t.noFee], [t.youReceive, `${money(Number(detail(receipt, "receive") ?? receipt.amount))}៛`], [t.method, `${method} ··${last4}`]];
    if (receipt.kind === "CASHOUT_PAID") return [[t.method, `${method} ··${last4}`], [t.reference, String(detail(receipt, "providerRef") ?? "—")]];
    return [[t.method, `${method} ··${last4}`]];
  }
  function receiptCard(receipt: Receipt) {
    const signed = receipt.delta > 0 ? `+${money(receipt.amount)}៛` : receipt.delta < 0 ? `−${money(receipt.amount)}៛` : `${money(receipt.amount)}៛`;
    return <div className="receipt-card" key={receipt.id}>
      <div className="receipt-head"><ReceiptText size={18}/><strong>{t[`kind${receipt.kind}`]}</strong></div>
      <div><span>{t.receiptNo}</span><strong>{receipt.number}</strong></div>
      <div><span>{t.amountLabel}</span><strong>{signed}</strong></div>
      {receiptLines(receipt).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      <div><span>{t.balanceAfter}</span><strong>{money(receipt.balanceAfter)}៛</strong></div>
      <small>{new Date(receipt.createdAt).toLocaleString(lang === "km" ? "km-KH" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</small>
    </div>;
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
    setBusy(true); setError(""); setEstimatorBusy(false); setScreen("verifying");
    try {
      const outcome = await uploadImageForEstimate(image, { replaces: retakeOf ?? undefined });
      // "success" and "low_confidence" both save an estimate; the result screen shows the chip for the latter.
      setResult(outcome.scan); setVerifier(outcome.verifier); setRetakeOf(null); await refresh(); setScreen("result");
    } catch (cause) {
      // Estimator offline/asleep/timeout: keep the photo so one tap retries it.
      if (cause instanceof EstimatorUnavailableError) setEstimatorBusy(true);
      else setError(cause instanceof Error ? cause.message : "Photo verification failed. Please try another photo.");
      setScreen("scan");
    }
    finally { setBusy(false); }
  }

  async function cashout() {
    if (!savedMethod) { setError(t.payoutMethod); setScreen("payout"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, method: savedMethod.method, account: savedMethod.account, confirmed: true }) });
      const data: { payout?: Payout; receipt?: Receipt; error?: string } = await response.json();
      if (!response.ok || !data.payout || !data.receipt) throw new Error(data.error ?? "The cash-out could not be requested. Check the details and try again.");
      setPayout(data.payout); setPayoutReceipt(data.receipt); await refresh(); setScreen("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The cash-out could not be requested. Check the details and try again."); setScreen("confirm"); }
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

  function resetPhoto() { if (photo) URL.revokeObjectURL(photo); setPhoto(""); setImage(null); setResult(null); setError(""); setEstimatorBusy(false); setRetakeOf(null); setScreen("scan"); }
  /** Low-confidence retake: the new photo replaces this estimate instead of adding a second one. */
  function retakeForBetterEstimate() { const replaced = result?.id ?? null; resetPhoto(); setRetakeOf(replaced); window.setTimeout(() => cameraRef.current?.click(), 0); }

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
          {slide === 0 ? <div className="story-visual"><div className="sun-disc"><Leaf size={52} strokeWidth={1.4}/></div><div className="points-chip"><Coins size={19}/><strong>+{POINTS_PER_ITEM.cans} pts</strong></div></div>
            : slide === 1 ? <div className="story-visual price-list"><div className="price-row"><span className="price-mark"><Recycle size={18}/></span><span>{t.aluminium}</span><strong>{POINTS_PER_ITEM.cans}៛ <small>{t.perCan}</small></strong></div><div className="price-row"><span className="price-mark"><Recycle size={18}/></span><span>{t.plastic}</span><strong>{POINTS_PER_ITEM.bottles}៛ <small>{t.perBottle}</small></strong></div></div>
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
        <section className="wallet-balance-card"><div className="balance-caption">{t.balance}</div><div className="balance-total">{money(balance)}<span>៛</span></div><div className="balance-caption balance-goal">{t.cashoutGoal}<span>{Math.floor(progress)}%</span></div><div className="balance-track"><span style={{ width: `${progress}%` }}/></div><div className="balance-note">{money(balance)}៛ = {money(balance)} pts{usd(balance) && <> · {usd(balance)}</>}</div>{pendingEstimate > 0 && <div className="balance-pending">≈ +{money(pendingEstimate)}៛ {t.pendingPickup} · {t.notSpendable}</div>}</section>
        <div className="home-actions"><button className="button gold-button" onClick={() => { resetPhoto(); }}><ScanLine size={19}/>{t.scan}</button><button className="button outline-button" onClick={() => { setAmountText(balance >= MINIMUM ? String(MINIMUM) : ""); changeScreen("wallet"); }}><Wallet size={19}/>{t.cashout}</button></div>
        <div className="section-heading"><h2>{t.recent}</h2><button className="refresh-button" onClick={() => void refresh()}>{t.refresh}</button></div>
        <div className="activity-list">{activity.length === 0 ? <div className="empty-state"><span className="empty-icon"><Recycle size={24}/></span><p>{t.empty}</p></div> : activity.map((item) => { const shown = activityAmount(item); const counts = item.status === "VERIFIED" ? { cans: item.verifiedCans ?? 0, bottles: item.verifiedBottles ?? 0 } : { cans: item.cans ?? 0, bottles: item.bottles ?? 0 }; return <button type="button" className="activity-row" key={item.id} onClick={() => setOpenItem(item)} aria-label={`${t.viewReceipt}: ${activityStatus(item.status)}`}><span className="activity-icon">{item.kind === "SCAN" ? <Recycle size={19}/> : <Banknote size={19}/>}</span><span className="activity-copy"><strong>{item.kind === "SCAN" ? `${item.status === "ESTIMATED" ? "≈ " : ""}${counts.cans} ${t.cans} · ${counts.bottles} ${t.bottles}` : `${t.cashout} · ${item.method}`}</strong><small>{new Date(item.createdAt).toLocaleDateString(lang === "km" ? "km-KH" : "en-US", { month: "short", day: "numeric" })} · {activityStatus(item.status)}</small></span><b className={shown.tone}>{shown.text}</b></button>; })}</div>
      </section>}

      {screen === "scan" && <section className="scan-content"><div className="scan-heading"><span className="eyebrow">{t.scan}</span><button className="close-button" onClick={() => changeScreen("home")} aria-label="Close"><X size={20}/></button></div><h1 className="page-title">{photo ? t.review : t.startScanning}</h1><p className="page-subtitle">{photo ? t.review : t.photoHint}</p>
        <div className={`camera-preview ${photo ? "photo-preview" : ""}`}>{photo ? <img src={photo} alt="Recycling items for verification"/> : <div className="camera-frame"><span className="corner top-left"/><span className="corner top-right"/><span className="corner bottom-left"/><span className="corner bottom-right"/><div className="frame-message"><span className="frame-icon"><Recycle size={29}/></span><strong>{t.cans} &amp; {t.bottles}</strong></div></div>}</div>
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void preparePhoto(file); }}/><input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void preparePhoto(file); }}/>
        {!photo ? <div className="scan-controls"><button className="button outline-button" disabled={busy} onClick={() => cameraRef.current?.click()}><ScanLine size={19}/>{busy ? "…" : t.camera}</button><button className="button outline-button" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={19}/>{t.gallery}</button></div> : <div className="scan-controls"><button className="button outline-button" disabled={busy} onClick={() => { resetPhoto(); window.setTimeout(() => cameraRef.current?.click(), 0); }}>{t.retake}</button><button className="button gold-button" disabled={busy} onClick={() => void submitScan()}>{t.submit}<ArrowRight size={17}/></button></div>}
        {estimatorBusy && <div className="busy-notice" role="status"><strong>{t.busyTitle}</strong><span>{t.busyText}</span><button className="button outline-button" disabled={busy} onClick={() => void submitScan()}>{t.tryAgainNow}</button></div>}{retakeOf && !estimatorBusy && <p className="estimate-note">{t.retakeReplaces}</p>}{error && <div className="error-message">{error}</div>}<p className="scan-limit-note">{t.dailyLimit}</p>
      </section>}

      {screen === "verifying" && <section className="status-screen"><span className="large-spinner"/><h1>{t.checking}</h1></section>}

      {screen === "result" && result && <section className="result-content"><div className="result-check"><CircleCheck size={27}/></div><h1 className="page-title">{t.result}</h1>{result.lowConfidence && <div className="confidence-chip" role="status"><span className="chip-dot"/>{t.lowConfidence}</div>}<p className="page-subtitle">{result.lowConfidence ? t.lowConfidenceHelp : t.resultSub}</p>
        <div className="result-card"><div className="result-counts"><div><small>{t.cans}</small><strong>≈ {result.cans}</strong></div><div><small>{t.bottles}</small><strong>≈ {result.bottles}</strong></div></div><div className="result-line"><span>{t.weight}</span><strong>≈ {new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(result.kg)} kg</strong></div><div className="result-line"><span>{t.rate}</span><strong>{POINTS_PER_ITEM.cans}៛ {t.perCan} · {POINTS_PER_ITEM.bottles}៛ {t.perBottle}</strong></div><div className="result-points"><span>{t.pointsEarned}</span><strong>≈ +{money(result.estimatedPoints)}៛</strong></div><p className="estimate-note">{t.notSpendable}</p>{result.glassBottles > 0 && <p className="estimate-note">{t.glassNotAccepted}</p>}</div>
        {result.lowConfidence && <button className="button outline-button full-button" onClick={retakeForBetterEstimate}>{t.retakeBetter}</button>}{verifier === "MOCK" && <p className="mock-label">{t.verifierMock}</p>}{error && <div className="error-message">{error}</div>}<button className="button gold-button full-button" onClick={() => changeScreen("home")}>{t.claim}<ArrowRight size={18}/></button>
      </section>}

      {screen === "wallet" && <section className="wallet-content"><p className="eyebrow">{t.wallet}</p><h1 className="wallet-number">{money(balance)}<span> pts</span></h1><p className="wallet-sub">= {money(balance)}៛{usd(balance) && <> · {usd(balance)}</>} · 1 pt = 1៛ · {t.minimum} · {t.noFee}</p>{pendingEstimate > 0 && <p className="balance-pending wallet-pending">≈ +{money(pendingEstimate)}៛ {t.pendingPickup} · {t.notSpendable}</p>}
        <label className="field-label">{t.amount}</label><input className="text-field amount-field" inputMode="numeric" placeholder={t.enterAmount} value={amountText} onChange={(event) => setAmountText(event.target.value.replace(/\D/g, ""))}/><div className="amount-chips">{[MINIMUM, 5000, balance].filter((value, index, list) => value >= MINIMUM && value <= balance && list.indexOf(value) === index).map((value) => <button key={value} className={`amount-chip ${amount === value ? "selected" : ""}`} onClick={() => setAmountText(String(value))}>{money(value)}៛</button>)}</div>
        {balance < MINIMUM && <p className="notice-text">{t.needMore} {money(MINIMUM - balance)}៛ {t.moreBefore}</p>}
        <div className="receive-summary"><span>{t.fee}</span><strong>{t.noFee}</strong></div><div className="receive-summary"><span>{t.youReceive}</span><strong>{money(quote.receive)}៛{usd(quote.receive) && <small className="usd-line"> {usd(quote.receive)}</small>}</strong></div><button className="payout-choice" onClick={() => { setMethod(savedMethod?.method ?? "ABA"); setAccount(savedMethod?.account ?? ""); changeScreen("payout"); }}><span className="method-mark">{savedMethod?.method ?? "ABA"}</span><span>{savedMethod ? `${savedMethod.method} ··${savedMethod.account.slice(-4)}` : t.payoutMethod}</span><ChevronRight size={19}/></button>
        {error && <div className="error-message">{error}</div>}<div className="wallet-footer"><button className="button gold-button full-button" disabled={amount < MINIMUM || amount > balance || !savedMethod} onClick={() => { if (!savedMethod) { changeScreen("payout"); return; } changeScreen("confirm"); }}>{t.cashout}<ArrowRight size={18}/></button></div>
      </section>}

      {screen === "payout" && <section className="sheet-backdrop"><div className="bottom-sheet"><div className="sheet-grabber"/><p className="eyebrow">{t.wallet}</p><h1 className="page-title">{t.payoutMethod}</h1><p className="page-subtitle">{t.choosePayout}</p>
        <div className="method-options">{(["ABA", "ACLEDA", "VISA"] as const).map((value) => <button key={value} className={`method-option ${method === value ? "selected" : ""}`} onClick={() => setMethod(value)}><span className="method-mark">{value === "VISA" ? "Visa" : value}</span><span>{value === "VISA" ? "Visa card" : `${value} account`}</span>{method === value && <Check className="method-check" size={18}/>}</button>)}</div>
        <label className="field-label">{t.account}</label><input className="text-field account-field" inputMode="numeric" placeholder={t.accountHint} value={account} onChange={(event) => setAccount(event.target.value.replace(/[^0-9 -]/g, "").slice(0, 32))}/>{error && <div className="error-message">{error}</div>}
        <button className="button gold-button full-button" disabled={account.replace(/\D/g, "").length < 6} onClick={() => { setSavedMethod({ method, account }); setError(""); setScreen("wallet"); }}>{t.saveContinue}<ArrowRight size={18}/></button><p className="sandbox-note">{t.sandbox}</p>
      </div></section>}

      {screen === "confirm" && <section className="sheet-backdrop"><div className="bottom-sheet"><div className="sheet-grabber"/><p className="eyebrow">{t.wallet}</p><h1 className="page-title">{t.confirm}</h1><p className="page-subtitle">{t.reviewPayout}</p><div className="confirm-card"><div><span>{t.amountLabel}</span><strong>{money(amount)}៛</strong></div><div><span>{t.fee}</span><strong>{t.noFee}</strong></div><div><span>{t.youReceive}</span><strong>{money(quote.receive)}៛</strong></div><div><span>{t.method}</span><strong>{savedMethod?.method}</strong></div><div><span>{t.accountLast}</span><strong>··{savedMethod?.account.slice(-4)}</strong></div></div>{error && <div className="error-message">{error}</div>}<button className="button gold-button full-button" disabled={busy} onClick={() => void cashout()}>{busy ? <LoaderCircle className="spin" size={18}/> : t.send}<ArrowRight size={18}/></button><p className="sandbox-note">{t.sandbox}</p></div></section>}

      {screen === "success" && <section className="status-screen success-screen"><span className="success-mark"><Check size={32}/></span><h1>{t.payoutSuccess}</h1><p>{money(payout?.amount ?? amount)}៛ · {payout?.method ?? savedMethod?.method} · {activityStatus(payout?.status ?? "REQUESTED")}</p>{payoutReceipt && receiptCard(payoutReceipt)}<p className="sandbox-note">{t.sandbox}</p><button className="button gold-button full-button" onClick={() => changeScreen("home")}>{t.done}<ArrowRight size={18}/></button></section>}

      {openItem && <section className="sheet-backdrop" onClick={() => setOpenItem(null)}><div className="bottom-sheet" role="dialog" aria-modal="true" aria-label={t.receipt} onClick={(event) => event.stopPropagation()}><div className="sheet-grabber"/><p className="eyebrow">{activityStatus(openItem.status)}</p><h1 className="page-title">{t.receipt}</h1>
        {openItem.receipts.length > 0 ? <div className="receipt-list">{openItem.receipts.map(receiptCard)}</div>
          : <div className="confirm-card">{openItem.kind === "SCAN" && <><div><span>{t.cans}</span><strong>≈ {openItem.cans ?? 0}</strong></div><div><span>{t.bottles}</span><strong>≈ {openItem.bottles ?? 0}</strong></div>{openItem.status === "ESTIMATED" && <div><span>{t.pointsEarned}</span><strong>≈ +{money(openItem.estimatedPoints ?? 0)}៛</strong></div>}{openItem.reason && <div><span>{t.rejected}</span><strong>{openItem.reason}</strong></div>}</>}<p className="estimate-note">{t.noReceiptYet}</p></div>}
        <button className="button outline-button full-button" onClick={() => setOpenItem(null)}>{t.close}</button></div></section>}
    </div>

    {isSignedIn && ["home", "wallet"].includes(screen) && <nav className="floating-tabs"><button className={`tab-item ${screen === "home" ? "active" : ""}`} onClick={() => changeScreen("home")}><House size={21}/><span>{t.home}</span></button><button className="scan-fab" onClick={() => { setPhoto(""); setImage(null); changeScreen("scan"); }} aria-label={t.scan}><ScanLine size={23}/></button><button className={`tab-item ${screen === "wallet" ? "active" : ""}`} onClick={() => { setAmountText(balance >= MINIMUM ? String(MINIMUM) : ""); changeScreen("wallet"); }}><Wallet size={21}/><span>{t.wallet}</span></button></nav>}
  </main>;
}
