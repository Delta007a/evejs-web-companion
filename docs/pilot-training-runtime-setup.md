# Pilot Training runtime patches

These artifacts target the audited **EveJS 0.12.9** layout with runtime source under
`server/src`. The integration was verified against a mutable 0.12.9 gameplay copy,
not arbitrary newer EveJS releases. Do not infer compatibility from a version label
alone: check the five files in the [hash manifest](../runtime-patches/runtime-hashes.json).

Patch your **mutable gameplay copy**, never an immutable clean upstream reference.
Preserve local mods, loader wiring and configuration. Back up the affected files and
rehearse in a disposable copy before planned maintenance. Do not replace whole
runtime files from a clean distribution to make a patch apply.

## What is included

- [live-factory-gateway.patch](../runtime-patches/live-factory-gateway.patch): the
  first live-session/acquisition boundary across four existing runtime files.
  This is a zero-context patch and requires `git apply --unidiff-zero` **only after
  verifying its base**; line numbers alone are not a compatibility check.
- [pilot-training-generic.patch](../runtime-patches/pilot-training-generic.patch):
  follow-up CEO exclusion and generic/SELF funding changes to the gateway runtime
  and acquisition helper.
- [factorySkillAcquisition.js](../runtime-patches/factorySkillAcquisition.js): the
  **complete current** helper, already including the follow-up changes.
- [runtime-hashes.json](../runtime-patches/runtime-hashes.json): audited original,
  previous-feature where applicable, and current bytewise SHA-256 values.

The boundary must retain free-pilot-only acquisition, account identity, CEO exclusion,
pending-financial-operation release guards, explicit wallet authority and verified
funding journals. A patch that merely applies is not sufficient evidence of these
semantics on a different/custom base.

## Choose the matching installation state

**Already current:** if all five files match the current accepted content, do not
apply either patch again. The integration environment was already in this state;
publication did not redeploy its runtime.

**Earlier live-session installation:** compare the gateway runtime and helper to
their `previousFeatureSHA256` values, and the other three files to `newSHA256`.
Rehearse/check, then apply `pilot-training-generic.patch` to both affected files.
Do not first replace the helper with the current full helper and then patch it again.

**Fresh supported base:** compare the four existing files to `originalSHA256`.
In a disposable copy, apply the initial patch, apply only the gateway-runtime portion
of the follow-up patch, and install the complete current helper. For example, in
PowerShell, with the WC repository as the initial working directory:

```powershell
$wcRoot = (Get-Location).Path
$gameplayRoot = 'C:\path\to\EveJS-gameplay-copy'

git -C $gameplayRoot apply --check --unidiff-zero "$wcRoot/runtime-patches/live-factory-gateway.patch"
git -C $gameplayRoot apply --unidiff-zero "$wcRoot/runtime-patches/live-factory-gateway.patch"

git -C $gameplayRoot apply --check --include=server/src/_secondary/express/evejsWebGatewayRuntime.js "$wcRoot/runtime-patches/pilot-training-generic.patch"
git -C $gameplayRoot apply --include=server/src/_secondary/express/evejsWebGatewayRuntime.js "$wcRoot/runtime-patches/pilot-training-generic.patch"

Copy-Item -LiteralPath "$wcRoot/runtime-patches/factorySkillAcquisition.js" -Destination "$gameplayRoot/server/src/_secondary/express/factorySkillAcquisition.js"
```

Check every command's result and stop on failure. These examples are not a blind
installer or permission to overwrite a customized helper. Verify the final five
files before repeating the reviewed procedure on the mutable gameplay copy.

## Hashes and line endings

Manifest hashes describe the exact audited bytes. The earlier helper was LF and
the current audited helper is CRLF; Git checkout/patch settings can change line
endings. A raw mismatch must be investigated, not silently accepted or fixed by
normalizing the running tree. Compare copies to establish whether the only change
is LF/CRLF; any other content difference needs review.

For a confirmed line-ending-only comparison, the following **current-content**
SHA-256 values are computed after replacing CRLF with LF (UTF-8, no other edits).
They are not substitutes for checking the original/previous patch base.

| File under `server/src/` | Current content, canonical LF SHA-256 |
| --- | --- |
| `_secondary/express/evejsWebGatewayRuntime.js` | `0DEFF97F52E4C32A667D165D5183C68B13417755F22DF58B0085130C303F265F` |
| `_secondary/express/evejsWebGateway.js` | `20808953E06FB49ECA4A5046EFD6686A3C1A6B5AE7CCE8B6A0CF67634186D31D` |
| `edge/gateway/gatewayRuntimeProtocol.js` | `987E1B06634DA05A1A278BC56D07EE1859B84DA5D758F20759970C144E86C307` |
| `services/character/charService.js` | `44EBA767318FCC560015395FAA5BCD97B628714C81DF8012DAB58D96C39FBD9A` |
| `_secondary/express/factorySkillAcquisition.js` | `F5F2F0C75163005B7D955F2E4A5947C4D68F4CE62CA8238BCA0FCF4375B5563F` |

Publication review replayed both patches against copies of the exact audited base
and compared all five results to the accepted deployed files, accounting only for
line endings. The current full helper also matches its raw manifest hash in the
audited checkout. No gameplay runtime file was changed for that check.

## Startup and WC update

Use your normal configured **launcher/mod-loader** startup after planned maintenance;
do not replace it with a bare runtime entry-point command. Set WC's ignored `.env`
`EVEJS_ROOT` to the same gameplay copy and configure the gateway URL/token for your
deployment. Character-event streaming has its own token/readiness requirement;
successful read endpoints alone do not establish that the stream is configured.

Update/install WC dependencies and run `npm run build:web` before starting WC through
your normal setup. The WC setup scripts do not automatically install these Training
patches. Preserve your private `.env`, browser preferences and runtime data outside
version control. Do not publish tokens with bug reports.
