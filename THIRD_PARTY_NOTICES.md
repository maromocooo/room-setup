# Third-party notices

Room Setup's own code and documentation are licensed under [MIT](LICENSE). That license covers only what the Room Setup contributors wrote. The generation engines, their model weights, their dependencies and the models they generate are **not** covered by it and keep their own terms.

Room Setup 独自のコードと文書は [MIT](LICENSE) です。生成エンジン、モデルの重み、それらの依存物、生成されたモデルには MIT は適用されず、それぞれの条件に従います。

## Generation engines (not included)

None of the engines below are bundled with or redistributed by this repository. You install them yourself from upstream, and their licenses apply to that installation and to what you generate with it. Check the current upstream terms before using generated models, particularly for commercial use or distribution.

### Tencent Hunyuan 3D 2.1

Code and weights are licensed under the **Tencent Hunyuan 3D 2.1 Community License Agreement**, not MIT. Its terms include, among others, a territory restriction (the license does not apply in the European Union, the United Kingdom or South Korea), additional conditions for large-scale commercial use, attribution and redistribution requirements, and an acceptable use policy. See the [upstream license](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE) and [model license](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE). Reference copies: [third_party/HUNYUAN3D_LICENSE.txt](third_party/HUNYUAN3D_LICENSE.txt), [third_party/HUNYUAN3D_UPSTREAM_NOTICE.txt](third_party/HUNYUAN3D_UPSTREAM_NOTICE.txt).

> Tencent Hunyuan 3D 2.1 is licensed under the Tencent Hunyuan 3D 2.1 Community License Agreement, Copyright © 2025 Tencent. All Rights Reserved. The trademark rights of “Tencent Hunyuan” are owned by Tencent or its affiliate.

Room Setup is an independent project and is not affiliated with, sponsored or endorsed by Tencent.

### Microsoft TRELLIS and TRELLIS.2

The [TRELLIS](https://github.com/microsoft/TRELLIS) and [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) repositories are MIT-licensed by Microsoft Corporation; check the model cards on Hugging Face for the weights' terms. Both depend on third-party components with their own licenses, some of them non-commercial (for example NVIDIA's nvdiffrast). Review the upstream repositories' dependency licenses for your use case.

Room Setup is not affiliated with, sponsored or endorsed by Microsoft.

### Tencent ARC Pixal3D

[Pixal3D](https://github.com/TencentARC/Pixal3D)'s code and weights are released under the MIT License (see its LICENSE and NOTICE; it is built on TRELLIS.2). At run time Pixal3D also downloads:

- **DINOv3** image encoder weights, via a third-party mirror (`camenduru/dinov3-vitl16-pretrain-lvd1689m`). DINOv3 is Meta's model under the **DINOv3 License**, not MIT. Its terms resemble the SAM License below: free use, modification and redistribution including commercial use, with conditions such as Trade Controls compliance, no military/weapons use, no reverse engineering, acknowledgement in publications, and a patent/IP-litigation termination clause. Meta distributes the official weights behind an access request. Using the mirror does not change which license applies.
- **MoGe-2** (`Ruicheng/moge-2-vitl`, MIT) for camera estimation, and a background-removal model.

### Meta SAM 3D Objects

[SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) code and checkpoints are under the **SAM License** (Meta), not MIT. It grants a royalty-free licence to use, reproduce, distribute, modify and create derivative works, and you own the derivatives you make. Conditions include:

- redistributing SAM Materials only under the SAM License, with a copy of it;
- acknowledging SAM in publications of research that uses it;
- complying with applicable law and Trade Controls, with no ITAR, military/warfare, nuclear, espionage or weapons uses;
- no reverse engineering of the materials;
- termination if you sue Meta claiming the materials or their outputs infringe your IP, plus an indemnity;
- Meta may update the licence; continued use means accepting the update.

The checkpoints are gated on Hugging Face (request access and log in before downloading). Room Setup does not include or redistribute any SAM Materials.

Room Setup is not affiliated with, sponsored or endorsed by Tencent or Meta.

### Other Python components

The gateway uses FastAPI, Uvicorn and python-multipart. The engines' environments use PyTorch, rembg, Hugging Face libraries and others under their own licenses. None of them are vendored here.

## JavaScript dependencies

Installed by npm and not vendored; `package-lock.json` records exact versions. Keep their notices when redistributing a build.

| Package | License | Use |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | MIT | 3D rendering, GLTF loading/export |
| [earcut](https://github.com/mapbox/earcut) | ISC | Floor triangulation |
| [jszip](https://github.com/Stuk/jszip) | MIT or GPL-3.0 (used under MIT) | Project files |
| [vite](https://github.com/vitejs/vite) | MIT | Development server and build (dev only) |
| [puppeteer-core](https://github.com/puppeteer/puppeteer) | Apache-2.0 | Browser smoke test (dev only) |

## Assets

The icons, flooring and wallpaper textures are drawn in code by this project. No photos, generated models or other third-party media are included in the repository.
