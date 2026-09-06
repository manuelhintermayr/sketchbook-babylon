# Third-Party Notices

**sketchbook-upgraded** is a maintained extension of the original
[`swift502/Sketchbook`](https://github.com/swift502/Sketchbook) engine that also
merges features from several later community forks. This document records the
upstream / fork history and the third-party libraries and assets, and separates
them from this fork's own contributions.

The narrative timeline and per-version, per-commit attribution live in the
[README](./README.md#project-timeline) and [`CHANGELOG.md`](./CHANGELOG.md); this
file is the consolidated licensing summary. Where a license could not be
established unambiguously, that is stated rather than assumed.

## 1. License of this repository

Distributed under the **MIT License** (see [LICENSE](./LICENSE)),
**Copyright (c) 2020 swift502**. The original author's copyright notice is
preserved unchanged. Contributions made in this fork are provided under the same
MIT License.

## 2. Upstream project and community forks

| Project | Author | Contribution used here | License |
|---|---|---|---|
| [`swift502/Sketchbook`](https://github.com/swift502/Sketchbook) | swift502 | Original three.js / cannon.js game engine (foundation, v0.1–v0.4) | **MIT** (© 2020 swift502) — see [LICENSE](./LICENSE) |
| [`cjmott/Sketchbook`](https://github.com/cjmott/Sketchbook) | cjmott | Sept 2024 toolchain revival (cannon-es, modern three.js `BufferGeometry`, updated sky shaders) | MIT — inherited from the MIT-licensed `swift502/Sketchbook`; see the fork's own repository |
| [`Inthenew/Sketchbook`](https://github.com/Inthenew) | Inthenew | Day/night cycle, wave ocean, boats, races, rocketship + Moon, lunar gravity (v0.6 feature set) | MIT — inherited from `swift502/Sketchbook`; see the fork's own repository |
| [`benhatsor/Joycon-Sketchbook`](https://github.com/benhatsor) | Bar Hatsor (barhatsor / benhatsor) | Joy-Con / gamepad integration | MIT — inherited from `swift502/Sketchbook`; see the fork's own repository |
| [`tkkaushik369/socketControl`](https://github.com/tkkaushik369) | tkkaushik369 | Race-checkpoint system, instanced grass field, Speaker, CylinderCollider, ShapeSpawnPoint, sandbox scenes, three.js editor workflow | **MIT** (as stated in this project's README timeline) |
| [`iErcann/Notblox`](https://github.com/iErcann) | iErcann | TriggerCube + ProximityPrompt design | See the `iErcann/Notblox` repository for its license |

Every port tries to preserve the original commits or authorship via
`git format-patch` / `git am` or `git commit --author=…` so that `git log`
credits each upstream author for their own work (see the README "Attribution
policy").

## 3. Third-party libraries

Each remains under its own license and copyright; refer to the respective
project for authoritative terms:

- **[three.js](https://github.com/mrdoob/three.js)** — MIT
- **[cannon-es](https://github.com/pmndrs/cannon-es)** — MIT
- **lil-gui**, **stats.js**, **cannon-es-debugger** — MIT (npm packages)
- **joycon.js** (benhatsor) — vendored under `vendor/joycon/` (originally loaded from `cdn.cde.run/Joycon.min.js`); see the upstream project for its license

## 4. Assets

- **Grass field technique** — based on the instanced-grass approach by Eddie Lee
  (<https://www.eddietree.com/grass>).
- **Background music** — bundled tracks generated with [Suno AI](https://suno.com/).
- **Image assets** — per the README (v0.6.0 note), six third-party images that
  Inthenew's upstream hotlinked (DeviantArt fan-art, an Imgur upload, Farmers
  Almanac and Adobe Stock photos, a Future plc CDN asset, and a Wikimedia photo
  with attribution requirements) were **not** vendored into this fork; they were
  dropped and replaced with generated (DALL·E) equivalents under `src/img/`.

Only assets whose origin is documented in the README, repository, or git history
are listed here; no origin has been invented.

## 5. Trademarks

Product and project names referenced above are the property of their respective
owners and are used for identification only.
