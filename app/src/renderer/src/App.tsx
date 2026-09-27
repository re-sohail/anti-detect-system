import { useState } from 'react';
import { EDUCATIONAL_NOTICE, INSTRUMENT_VERSION } from '@lvd/shared';
import { HostScreen } from './screens/HostScreen';
import { ImagesScreen } from './screens/ImagesScreen';
import { PresetsScreen } from './screens/PresetsScreen';
import { MachinesScreen } from './screens/MachinesScreen';
import { RunsScreen } from './screens/RunsScreen';
import { AuditScreen } from './screens/AuditScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ExitsScreen } from './screens/ExitsScreen';
import { ConsentScreen } from './screens/ConsentScreen';
import { PerformanceScreen } from './screens/PerformanceScreen';
import { StudyDataScreen } from './screens/StudyDataScreen';

const SCREENS = {
  host: { label: 'Host capacity', el: HostScreen },
  images: { label: 'Images', el: ImagesScreen },
  presets: { label: 'Presets', el: PresetsScreen },
  machines: { label: 'Machines', el: MachinesScreen },
  runs: { label: 'Runs & compare', el: RunsScreen },
  exits: { label: 'Network exits', el: ExitsScreen },
  consent: { label: 'Consent', el: ConsentScreen },
  performance: { label: 'Performance', el: PerformanceScreen },
  study: { label: 'Study data', el: StudyDataScreen },
  audit: { label: 'Audit log', el: AuditScreen },
  settings: { label: 'Settings', el: SettingsScreen },
} as const;
type ScreenKey = keyof typeof SCREENS;

export function App() {
  const [screen, setScreen] = useState<ScreenKey>('host');
  const Screen = SCREENS[screen].el;
  return (
    <div className="shell">
      {/* Shown on every screen (brief §2, §13). */}
      <div className="banner" role="note">{EDUCATIONAL_NOTICE}</div>
      <div className="body">
        <nav>
          <div className="brand">LVD Research Control</div>
          {(Object.keys(SCREENS) as ScreenKey[]).map((k) => (
            <button key={k} className={k === screen ? 'active' : ''} onClick={() => setScreen(k)}>
              {SCREENS[k].label}
            </button>
          ))}
          <div className="foot">Instrument v{INSTRUMENT_VERSION}</div>
        </nav>
        <main>
          <Screen />
        </main>
      </div>
    </div>
  );
}
