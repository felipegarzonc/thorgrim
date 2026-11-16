// This phone's own settings: notifications and sounds.

import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { Card, Icon, Seg } from "../../ui.tsx";
import { play, setSoundLevel, setSoundVolume, soundLevel, soundVolume, type SoundLevel } from "../../sound.ts";

/** The push key as the browser wants it. */
export function keyBytes(base64url: string) {
  const raw = atob((base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turn phone notifications on or off for this phone. iPhones need the app on the Home Screen first. */
export function PhoneNotifications() {
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (!supported) return setOn(false);
    void navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((sub) => setOn(!!sub && Notification.permission === "granted"));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site: allow them in the phone's settings.");
      const { key } = await api<{ key: string }>("/push/key");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      await api("/push/subscribe", { method: "POST", json: { subscription: sub.toJSON() } });
      setOn(true);
      setMsg("On. You'll hear about comments, reports of your games and opponents joining.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        await api("/push/unsubscribe", { method: "POST", json: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setOn(false);
      setMsg("Off for this phone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Phone notifications">
      {!supported ? (
        <p className="small muted">
          {ios && !installed
            ? "On iPhone, add Thorgrim to your Home Screen first (Share › Add to Home Screen), open it from there, and turn notifications on here."
            : "This browser can't show notifications."}
        </p>
      ) : (
        <>
          <p className="small muted">Comments on your posts, reports of your games and opponents joining your games, on this phone.</p>
          {on ? (
            <div className="two-buttons">
              <button type="button" className="outline" disabled={busy} onClick={() => api("/push/test", { method: "POST" }).then(() => setMsg("Test sent."))}>
                Send a test
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={turnOff}>
                Turn off
              </button>
            </div>
          ) : (
            <button type="button" className="primary wide" disabled={busy || on === undefined} onClick={turnOn}>
              <Icon name="bell" /> {busy ? "Turning on…" : "Turn on notifications"}
            </button>
          )}
        </>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </Card>
  );
}

/** Sounds on this phone: off, only what helps at the table and the big moments, or everything. */
export function SoundSettings() {
  const [level, setLevel] = useState<SoundLevel>(soundLevel());
  const [volume, setVolume] = useState(soundVolume());
  return (
    <Card title="Sounds">
      <Seg
        label="Sounds"
        value={level}
        options={[
          ["off", "Off"],
          ["important", "Important"],
          ["all", "All"],
        ]}
        onChange={(l) => {
          setSoundLevel(l);
          setLevel(l);
          if (l !== "off") play(l === "all" ? "tap" : "score");
        }}
      />
      <p className="muted small">
        {level === "off"
          ? "No sounds on this phone (it still buzzes on Android)."
          : level === "important"
            ? "Points, turns, rounds, the clock, dictation, results, level ups and notices. The phone's silent switch mutes them."
            : "Everything, also taps, votes, reactions and cheers."}
      </p>
      {level !== "off" && (
        <div className="sound-row">
          <label className="sound-volume">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                setSoundVolume(Number(e.target.value));
                setVolume(Number(e.target.value));
              }}
              onPointerUp={() => play("score")}
            />
          </label>
          <button type="button" className="small" onClick={() => play("victory", { force: true })}>
            Hear a victory
          </button>
        </div>
      )}
    </Card>
  );
}
