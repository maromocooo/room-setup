# AIアシスタントで部屋を作る（MCP）

[English](mcp.md) | **日本語** | [README](../README.ja.md)

Room Setup には [Model Context Protocol](https://modelcontextprotocol.io) サーバーが付属しています。Claude Code や Claude Desktop など、画像を理解できるアシスタントに接続して、自分の部屋の再現を頼めます：

> リビングの真ん中から四隅を撮った写真4枚と、間取り図、ソファ・テレビ台・棚の商品リンクです。Room Setup で部屋を作って。

写真と間取り図はアシスタント自身が読み取ります。そのうえでツールを使って、壁を描き、内装を選び、リンク先から商品画像と寸法を取得し、家具を生成・配置します。最後にスクリーンショットを撮って写真と見比べ、配置を直します。すべて開いているアプリにリアルタイムで反映され、途中で手で直すこともできます。手で直した内容はアシスタントにも見えます。

## セットアップ

1. ゲートウェイのPythonパッケージ（MCP SDKを含む）を入れ、APIとアプリを起動します：

   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
   npm run api     # ターミナル1
   npm run dev     # ターミナル2。起動したらブラウザでアプリを開く
   ```

   アプリは開いたままにしてください。変更の表示と、アシスタントが頼むスクリーンショットの描画をアプリが担当します。家具の生成には少なくとも1つのエンジンが必要です（[engines.ja.md](engines.ja.md)）。`ROOM_SETUP_MOCK_ENGINE=1` にするとGPUなしでも一連の流れを試せます（家具は箱になります）。

2. アシスタントにサーバーを登録します。パスは絶対パスで指定してください。

   **Claude Code**

   ```bash
   claude mcp add room-setup -- /path/to/room-setup/.venv/bin/python /path/to/room-setup/server/mcp_server.py
   ```

   **Claude Desktop**（`claude_desktop_config.json`）

   ```json
   {
     "mcpServers": {
       "room-setup": {
         "command": "/path/to/room-setup/.venv/bin/python",
         "args": ["/path/to/room-setup/server/mcp_server.py"]
       }
     }
   }
   ```

   サーバーはプロジェクトの `.env` から `API_PORT` を読みます。別のアドレスを使う場合は、サーバーの環境変数に `ROOM_SETUP_API`（例：`http://127.0.0.1:8001`）を設定します。

3. 写真と間取り図（添付、Claude Codeならファイルパス）と商品リンクをアシスタントに渡します。`furnish_room` プロンプトに定型の依頼文があります。

## うまく作るコツ

- **写真**：部屋の中央に立ち、各コーナーを2面の壁と床が入るように撮影します。明るい時間帯や広角レンズがおすすめです。
- **間取り図**：寸法（または帖数）が読める画像があると、部屋のサイズが正確になります。無い場合は写真から推定し、前提にした寸法をアシスタントが説明します。
- **商品**：無地背景の商品写真と寸法が載っているページが最適です。Amazonなど一部のショップは自動アクセスを拒否することがあります。その場合、アシスタントが画像と寸法を尋ねるか、`crop_photo` で写真から家具を切り抜きます。
- 生成は1点ずつ順番に行われ、エンジンにより1点あたり1〜3分ほどかかります。生成中の家具は半透明の箱で表示されます。
- アプリで結果を確認し、気になるところは手で直してください。「ソファを動かしたので続けて」と伝えれば、アシスタントは変更を読み取って続きをします。

## ツール

| ツール | 内容 |
|---|---|
| `get_room` | 壁・内装・家具（ID、サイズ、位置、状態）とプリセット名 |
| `set_room_outline` | 角の座標（cm）から閉じた外形で壁を置き換え。天井高も指定可 |
| `add_wall`, `remove_wall` | 間仕切りの追加と修正 |
| `add_opening`, `update_opening`, `remove_opening` | ドア・窓：プリセット、サイズ、床からの高さ、壁上の位置、吊元・開く向き |
| `set_ceiling_height` | 天井の高さ（cm） |
| `set_finishes` | 床材・壁紙のプリセットまたは画像、柄の大きさ、特定の壁だけの変更 |
| `clear_room` | 最初からやり直す |
| `add_light`, `update_light`, `remove_light`, `set_time_of_day` | 生成したランプへの光源の取り付け（`attach_to_furniture_id`）や照明器具。明るさ・色温度・点灯、朝／昼／夕方／夜の切り替え |
| `lookup_product` | 商品ページから商品名・寸法の記載・画像URL・メイン画像を取得 |
| `crop_photo` | 部屋の写真から家具を切り抜いて生成用の画像にする |
| `list_engines` | 使える生成エンジン |
| `add_furniture` | 画像から3Dモデルを生成して配置（サイズ・位置・向き） |
| `update_furniture`, `remove_furniture` | 移動・回転・サイズ変更・名前変更・削除。上下逆・横倒しで生成されたモデルの向き直し（`flip_upside_down`・`tip`） |
| `wait_for_furniture` | 生成の完了を待つ（進み具合を報告） |
| `render_view` | スクリーンショット：全体・真上・間取り・任意の視点 |

**座標**：間取り上のセンチメートルです。xは右、yは下向きに増えます。家具の位置は床に投影した形の中心です。`facing_deg` は正面の向きで、0＝下（+y）、90＝右、180＝上、270＝左です。

## 仕組み

ゲートウェイが共有の部屋データ（`generated/scene.json`）を1つ持っています。MCPサーバーはHTTPでこれを編集し、リビジョン番号を使ってユーザーの同時編集を上書きしないようにします。ブラウザは変更通知（`/api/scene/events`）を購読し、自分の編集も送り返します。`add_furniture` は仮の家具を登録して、それに紐づいた生成ジョブを開始します。ジョブが終わるとゲートウェイがモデルを書き込み、開いているアプリが箱をモデルに差し替えます。スクリーンショットも同じ通知経由でアプリに依頼して描画するため、`render_view` を使うにはブラウザでアプリを開いておく必要があります。

MCPサーバーが通信する相手は、ローカルのゲートウェイと、アシスタントが取得を頼んだ商品ページ・画像のURLだけです。
