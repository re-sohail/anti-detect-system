# Instrument coverage and stability

Values are the share of visits with an observed value. Absences carry reason codes.

| Field | Family | managed-guest | Unchanged across repeat visits |
|---|---|---|---|
| `geo.position` | location | 0% (permission-not-requested×4) | 100% of 2
| `intl.locale` | browser-config | 100% | 100% of 2
| `intl.timeZone` | browser-config | 100% | 100% of 2
| `intl.timezoneOffsetMin` | browser-config | 100% | 100% of 2
| `nav.cookieEnabled` | browser-config | 100% | 100% of 2
| `nav.deviceMemory` | browser-config | 0% (insecure-context×4) | 100% of 2
| `nav.hardwareConcurrency` | browser-config | 100% | 100% of 2
| `nav.languages` | browser-config | 100% | 100% of 2
| `nav.platform` | browser-config | 100% | 100% of 2
| `nav.userAgent` | browser-config | 100% | 100% of 2
| `nav.webdriver` | browser-config | 100% | 100% of 2
| `perf.navigation` | temporal | 100% | 0% of 2
| `perf.timerResolution` | temporal | 100% | 100% of 2
| `perm.states` | browser-config | 100% | 100% of 2
| `render.canvas2d` | rendering | 0% (disabled-by-protocol×4) | 100% of 2
| `render.webglRenderer` | rendering | 0% (disabled-by-protocol×4) | 100% of 2
| `screen.colorDepth` | display | 100% | 100% of 2
| `screen.devicePixelRatio` | display | 100% | 100% of 2
| `screen.size` | display | 100% | 100% of 2
| `screen.viewport` | display | 100% | 100% of 2
| `storage.testToken` | browser-config | 100% | 50% of 2
| `uach.highEntropy` | browser-config | 0% (disabled-by-protocol×4) | 100% of 2
| `uach.lowEntropy` | browser-config | 0% (insecure-context×4) | 100% of 2
