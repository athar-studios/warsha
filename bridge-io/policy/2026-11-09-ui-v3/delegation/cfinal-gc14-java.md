# C-final GC.14 environment — RESOLVED (orchestrator functional check, 2026-11-09T21:01Z)

The cfinal-environment.md risk "apksigner needs java; JAVA_HOME absent" is resolved:
- Java runtime present: `C:/Program Files/Android/Android Studio/jbr/bin/java.exe` = OpenJDK 25.0.3 (2026-04-21).
- Functional proof: `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"` then
  `"$LOCALAPPDATA/Android/Sdk/build-tools/36.0.0/apksigner.bat" version` → `0.9`, exit 0.
- At C-final set `JAVA_HOME=C:/Program Files/Android/Android Studio/jbr` before GC.14
  (`apksigner verify --print-certs <bundle>/app-release.apk` + `aapt2 dump badging … versionName`).
- Java 25 prints cosmetic native-access WARNINGs (org.conscrypt.NativeLibraryUtil); they do not affect the verify.
  Optionally silence with `--enable-native-access=ALL-UNNAMED` via JAVA_TOOL_OPTIONS; not required.
- aapt2.exe (2.20-13193326) needs no java. GC.14 is NOT an owner-only blocker; never fake the verify.