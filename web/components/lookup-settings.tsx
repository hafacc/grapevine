"use client";

import { type ReactElement, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { LuMapPin, LuMapPinOff, LuSearch, LuSearchX } from "react-icons/lu";
import {
  type LookupSettings,
  lookupSettings,
  saveLookupSetting,
} from "../utils/lookup";
import RateRow from "./ui/rate-row";

// A switch drawn as the link row is: what is so, on one line, and a swipe (at
// desktop width a worded button) that changes it. No swipe hint of its own:
// the link row's, just above, teaches the gesture.
function SettingRow({
  subject,
  on,
  saidOn,
  saidOff,
  iconOn,
  iconOff,
  onChange,
}: {
  subject: string;
  on: boolean;
  saidOn: string;
  saidOff: string;
  iconOn: IconType;
  iconOff: IconType;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <div className="border-b border-border">
      <RateRow
        subject={subject}
        value={null}
        sides={on ? "no" : "yes"}
        labels={
          on
            ? { no: { word: "turn off", icon: iconOff } }
            : { yes: { word: "turn on", icon: iconOn } }
        }
        onRate={() => onChange(!on)}
        contentClassName="bg-surface"
      >
        <p
          data-setting={subject}
          className={`flex min-h-[56px] items-center px-4 py-2.5 text-[16px] ${on ? "" : "text-muted"}`}
        >
          {on ? saidOn : saidOff}
        </p>
      </RateRow>
    </div>
  );
}

// Per device: what this browser sends when a thing is added (`/privacy/`).
export default function LookupSettingsLines(): ReactElement {
  // Read after mount: storage is not there during the static export.
  const [settings, setSettings] = useState<LookupSettings>({
    lookUp: true,
    useLocation: true,
  });
  useEffect(() => {
    setSettings(lookupSettings());
  }, []);

  function change(which: keyof LookupSettings, on: boolean): void {
    saveLookupSetting(which, on);
    setSettings((current) => ({ ...current, [which]: on }));
  }

  return (
    <div>
      <SettingRow
        subject="lookups"
        on={settings.lookUp}
        saidOn="lookups are on"
        saidOff="lookups are off"
        iconOn={LuSearch}
        iconOff={LuSearchX}
        onChange={(on) => change("lookUp", on)}
      />
      {/* Gone while lookups are off: it would change nothing. */}
      {settings.lookUp ? (
        <SettingRow
          subject="your location"
          on={settings.useLocation}
          saidOn="lookups use your location"
          saidOff="lookups don't use your location"
          iconOn={LuMapPin}
          iconOff={LuMapPinOff}
          onChange={(on) => change("useLocation", on)}
        />
      ) : null}
    </div>
  );
}
