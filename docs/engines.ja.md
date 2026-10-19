# 生成エンジン

[English](engines.md) | **日本語** | [README](../README.ja.md)

Room Setup にはモデルのコードや重みを同梱しません。各エンジンを作者の手順どおりに専用のPython環境へ導入し、その場所をゲートウェイに設定します。エンジンが必要になると、ゲートウェイがその環境のPythonで小さなワーカースクリプト（[`server/engines/worker.py`](../server/engines/worker.py)）を起動します。

## エンジンの導入

1. 公式の導入手順に従います。PyTorch/CUDAの要件がエンジンごとに違うので、環境（virtualenv / Conda）はエンジンごとに分けてください。
   - Hunyuan3D 2.1：<https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1>
   - TRELLIS.2：<https://github.com/microsoft/TRELLIS.2>
   - TRELLIS：<https://github.com/microsoft/TRELLIS>
   - Pixal3D：<https://github.com/TencentARC/Pixal3D>。TRELLIS.2の環境を流用するため、その環境を複製（`conda create -n pixal3d --clone trellis2`）してから、Pixal3Dの `requirements.txt`・`natten`・`utils3d` を入れると、TRELLIS.2側を壊しません（手順はPixal3DのREADME参照）。
   - SAM 3D Objects：<https://github.com/facebookresearch/sam-3d-objects>。重みはゲート付きです。Hugging Faceで利用申請し、`hf auth login` してから、README の手順で `checkpoints/hf` にダウンロードします。
2. その環境で公式のサンプルスクリプトが動くことを確認します。動かない場合、ゲートウェイからも読み込めません。
3. `.env.example` を `.env` にコピーし、エンジンごとに2つの変数を設定します：

   ```bash
   HUNYUAN3D_PYTHON=/path/to/envs/hunyuan3d/bin/python   # エンジン環境のPython
   HUNYUAN3D_ROOT=/path/to/Hunyuan3D-2.1                 # 公式リポジトリのチェックアウト
   ```

   接頭辞は `HUNYUAN3D_`・`TRELLIS2_`・`TRELLIS_`・`PIXAL3D_`・`SAM3D_` です。空欄にしたエンジンは使われず、アプリでは「未設定」と表示されます。
4. `npm run api` でゲートウェイを起動します（`.env` を読み込みます）。ゲートウェイ自体に必要なのは FastAPI・Uvicorn・python-multipart（`server/requirements.txt`）だけで、専用の小さなvenv（既定は `.venv`、`GATEWAY_PYTHON` で変更可）で動きます。

ワーカーは、エンジン本体が使うもの以外に追加の依存を必要としません。重みは初回利用時に公式コードがHugging Faceのキャッシュへダウンロードするため、各エンジンの最初の読み込みには時間がかかります。キャッシュ後は `.env` に `HF_HUB_OFFLINE=1` を書くとネットワークへのアクセスを止められます。

## 各エンジンの処理内容

| エンジン | 処理 | 出力 | テクスチャ切替 |
|---|---|---|---|
| `hunyuan3d` | rembgで背景除去 → Hunyuan3D-DiTで形状 →（任意）Hunyuan3D-PaintでPBR | GLB | あり。Paintは6視点・512px。失敗した場合は警告付きで形状のみを返します。 |
| `trellis2` | TRELLIS.2-4B → O-VoxelでGLB書き出し（20万面に削減、テクスチャ2048px） | WebPテクスチャ入りGLB | 常に色付き |
| `trellis` | TRELLIS-image-large → ガウシアン＋メッシュ → ベイク済みGLB（テクスチャ1024px） | GLB | 常に色付き |
| `pixal3d` | 背景除去 → MoGe-2でカメラ推定 → Pixal3D（既定1024、`PIXAL3D_RESOLUTION=1536` で高精細）→ O-VoxelでGLB（20万面・2048px） | WebPテクスチャ入りGLB | 常に色付き |
| `sam3d` | 物体マスク（画像のアルファ、無ければ背景除去）→ SAM 3D Objects → テクスチャをベイクしたメッシュ（ベイク失敗時は頂点カラー） | GLB | 常に色付き |

**ライセンスはエンジンごとに異なります。** TRELLIS・TRELLIS.2・Pixal3D はMITですが、Pixal3DはMetaのDINOv3（DINOv3 License）も読み込みます。Hunyuan3D 2.1はTencentの地域制限付きコミュニティライセンス、SAM 3D ObjectsはMetaのSAM Licenseです。生成物を商用利用する前に [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) を確認してください。

ブラウザが結果を入力した幅・奥行き・高さに合わせて拡大縮小するので、エンジンごとの単位の違いは気にしなくて構いません。

## 切り替えとGPUメモリ

- 常駐するエンジンは1つだけです。別のエンジンを使うジョブが来ると、ゲートウェイは今のワーカーに終了を指示し、終了を待ってから新しいワーカーを起動します。切り替えにはモデル1回分の読み込み時間（キャッシュ済みなら通常数十秒）がかかります。
- ジョブは投入順に1つずつ実行されます。異なるエンジンのジョブを続けてキューに入れても、切り替えは自動で行われます。
- `PRELOAD_ENGINE=hunyuan3d` を設定すると、ゲートウェイ起動時にすぐエンジンを読み込むため、最初のジョブで待たされません。
- Hunyuan3Dのテクスチャ生成中は、形状モデルを一時的にCPUへ移し、Paintモデルを読み込み、終わったら解放します。テクスチャありの場合はメモリ使用量も処理時間も大きく増えます。24GBのGPUなら既定の設定で全エンジンが動きます。それより小さいGPUでも、形状のみのHunyuan3D（10GB）やTRELLIS（16GB）なら動く場合があります。READMEのGPUメモリ表も参照してください。

## トラブル対処

ワーカーの出力は `logs/<エンジン>.log` に記録されます。まずここを確認してください。

- **アプリで「未設定」と表示される**：`*_PYTHON` が実在するPython、`*_ROOT` が実在するディレクトリを指している必要があります。`.env` を編集したらゲートウェイを再起動してください。
- **エンジンが「エラー」になる**：エンジン名の下にメッセージが表示されます。詳細はログにあります。エンジンを選んでもう一度生成すると、読み込みを再試行します。
- **TRELLISと `flash_attn`**：TRELLISは既定でflash-attentionを使います。環境に `flash_attn` が無い場合、ワーカーは自動で `xformers` に切り替えます。`.env` の `ATTN_BACKEND` / `SPARSE_ATTN_BACKEND` で明示的に指定することもできます。
- **モデル読み込み中にランダムなsegfaultや、ありえないPythonエラー**（標準ライブラリ内の `UnboundLocalError` など）：一部の第13・14世代Intelデスクトップ CPU で見られる症状です。そうした環境では、ワーカーを一部のコア（例：高効率コアのみ）に固定すると安定しました。`lscpu -e=CPU,CORE,MAXMHZ` でコア構成を確認し、`.env` に例えば `ENGINE_CPUSET=16-31` を設定してください。BIOS／マイクロコードの更新も確認してください。根本的な解決ではなく回避策です。
- **初回の読み込みがとても遅い**：重みをダウンロードしています。ログで進み具合を確認できます。
- **Pixal3D導入の注意点**（RTX 4090・CUDA 12.4で確認）：
  - MoGeは `pip install --no-deps git+https://github.com/microsoft/MoGe.git` で入れ、MoGeのメタデータにある `utils3d-moge` と `pipeline` を別途入れます。依存をそのまま入れると、Pixal3Dが固定しているバージョンと衝突します。
  - Pixal3D用の `utils3d` はTRELLIS.2のものと同じ番号なので、複製した環境では `pip install --force-reinstall --no-deps <wheel>` が必要です。
  - `natten` のビルドにはCMakeと、CUDAが対応するホストコンパイラが必要です。GCC 13とCUDA 12.4の組み合わせでは `CC=gcc-12 CXX=g++-12 CUDAHOSTCXX=g++-12` を指定します。
  - メモリ不足：ワーカーは既定でPixal3Dの省VRAMモードを使います。他のプロセスがGPUを使っていないか確認してください。
- **SAM 3D Objects導入の注意点**：
  - `lightning` が `pkg_resources` を使うため、`setuptools<81` にします。
  - nvdiffrastの `Cuda error: 209` は、そのGPU向けにビルドされていないという意味です。`TORCH_CUDA_ARCH_LIST` を指定して再ビルドしてください。
  - テクスチャのベイクには、mip-splatting版の `diff-gaussian-rasterization`（`kernel_size` 引数あり）が必要です。無い場合は頂点カラーで代用します。
- **生成は成功したが部屋で見ると形がおかしい**：無地の背景に家具が1つだけ写った鮮明な写真を使い、入力した幅・奥行き・高さを確認してください。インスペクタの「形を調整」で後から比率を直せます。

## エンジンの追加

1. `server/engines/<name>_engine.py` に `Engine(BaseEngine)` クラスを作り、次を実装します：
   - `load(self)`：公式コードをimportし（`self.root` 内のパスは `self.add_paths(...)` で追加）、重みを読み込む。
   - `generate(self, image_path, output_path, *, texture, seed, progress) -> dict`：`output_path` にGLBを書き、途中で `progress("shape")` などを呼ぶ（`preprocess`・`shape`・`texture`・`export` はUIに表示名あり）。戻り値は `{"texture_applied": bool, "warning_code": None | "texture_failed" | "texture_unavailable"}`。
   - 必要なら `recover(self)`（ジョブ失敗後に呼ばれる）。
2. `worker.py` の `ENGINE_MODULES` にモジュール名を登録します。
3. `server/gateway.py` に `EngineSpec`（id、表示名、環境変数の接頭辞、テクスチャ `"optional"` / `"always"`）を追加し、`src/core/i18n.js` に `engine.desc.<id>` の文言を追加します。

エンジンモジュールのトップレベルでは重いimportをしないでください。何かが足りないときにワーカーがきちんとエラーを報告できるようにするためです。最小の動作例は [`mock_engine.py`](../server/engines/mock_engine.py) です。
