// UI strings. Keep the two locales' keys identical (tests check this).

export const messages = {
    ja: {
        'view.label': '表示', 'view.plan': '間取り', 'view.room': '3D',
        'project.open': '開く', 'project.save': '保存',
        'language.label': '言語', 'theme.toggle': 'ライト／ダーク切替',

        'plan.tools': '間取りツール',
        'plan.tool.wall': '壁を描く (W) — ドラッグで描画、Shiftで角度を固定',
        'plan.tool.select': '選択・移動 (V) — 壁や端点をドラッグ',
        'plan.tool.erase': '削除 (E) — クリックした壁を削除',
        'plan.undo': '元に戻す (Ctrl+Z)', 'plan.redo': 'やり直す (Ctrl+Shift+Z)',
        'plan.fit': '全体を表示 (F)', 'plan.grid': 'グリッド', 'plan.units': '単位',
        'plan.empty.title': 'まずは部屋の形をつくりましょう',
        'plan.empty.body': 'ドラッグで壁を描くか、右の「テンプレート」から選べます',
        'plan.hud': '{x}, {y} · {zoom}%',

        'room.camera.orbit': '全体を見る', 'room.camera.top': '真上から', 'room.camera.inside': '室内の目線',
        'room.walls.solid': '壁を表示', 'room.walls.ghost': '手前の壁を下げる', 'room.walls.hidden': '壁を隠す',
        'room.gizmo.move': '家具を移動', 'room.gizmo.rotate': '家具を回転', 'room.brightness': '明るさ',
        'room.hint': 'ドラッグで回転 · 右ドラッグで移動 · ホイールでズーム · 家具をクリックで選択',
        'room.empty.title': '部屋がまだありません',
        'room.empty.body': '間取りで壁を閉じると、床と壁がここに立ち上がります',

        'tab.lights': '照明', 'lights.time': '時間帯',
        'time.morning': '朝', 'time.day': '昼', 'time.evening': '夕方', 'time.night': '夜',
        'lights.timeHint': '昼は窓から日が差し込み、夜は照明だけで照らします。3D表示で確認できます',
        'lights.add': '照明を追加', 'lights.hint': '種類を選んでから間取りをクリックすると置けます。置いた後はドラッグで移動できます',
        'lights.placed': '配置した照明', 'lights.empty': 'まだ照明はありません',
        'light.preset.ceiling': 'シーリングライト', 'light.preset.pendant': 'ペンダントライト', 'light.preset.downlight': 'ダウンライト',
        'light.preset.spot': 'スポットライト', 'light.preset.floor': 'フロアランプ', 'light.preset.table': 'テーブルランプ',
        'light.on': '点灯', 'light.lumens': '明るさ', 'light.kelvin': '色温度',
        'light.drop': '天井からの距離', 'light.height': '高さ',
        'light.shadows': '影を落とす', 'light.shadowsHint': '同時に影を出せるのは4灯までです',
        'light.preset.bulb': '家具の光源', 'light.inItem': '{name} の光源',
        'light.attachedHint': '家具の中の光源です。家具を動かすと一緒に動きます。位置は家具からのずれで指定します',
        'light.orphaned': '取り付け先の家具が見つかりません',
        'light.dx': '左右', 'light.dz': '前後',
        'inspector.addLight': '光源を付ける（ランプなど）',
        'light.kelvin.warm': '電球色', 'light.kelvin.warmWhite': '温白色', 'light.kelvin.neutral': '昼白色', 'light.kelvin.daylight': '昼光色',
        'tab.room': '部屋', 'tab.finish': '内装', 'tab.furniture': '家具',
        'room.templates': 'テンプレート', 'room.template.rectangle': '長方形', 'room.template.lShape': 'L字型',
        'room.width': '幅', 'room.depth': '奥行き', 'room.ceiling': '天井の高さ',
        'room.walls': '壁', 'room.walls.empty': '壁はまだありません',
        'room.summary': '床 {area} m² · 壁 {count}枚', 'room.summaryOpen': '壁 {count}枚 · 部屋が閉じていません',
        'room.clear': 'すべてクリア', 'room.clearConfirm': 'もう一度押すと壁と家具をすべて消します',
        'wall.item': '壁 {number}', 'wall.delete': 'この壁を削除',
        'opening.title': 'ドア・窓', 'opening.hint': 'プリセットを選んでから間取りの壁をクリックすると配置できます。置いた後はドラッグで移動できます。',
        'opening.style': '種類', 'opening.sill': '床からの高さ', 'opening.offset': '壁の端からの距離',
        'opening.flipHinge': '吊元を反転', 'opening.flipSide': '開く向きを反転', 'opening.flipSlide': '引く方向を反転',
        'opening.open': '開き具合（3D表示）',
        'opening.kind.door': 'ドア', 'opening.kind.window': '窓',
        'opening.preset.door-hinged': '片開きドア', 'opening.preset.door-double': '両開きドア',
        'opening.preset.door-sliding': '引き戸', 'opening.preset.door-opening': '開口のみ',
        'opening.preset.window-sliding': '引き違い窓', 'opening.preset.window-patio': '掃き出し窓',
        'opening.preset.window-tall': '大型引き違い窓', 'opening.color': 'ドアの色',
        'opening.color.white': 'ホワイト', 'opening.color.maple': 'メープル', 'opening.color.oak': 'オーク',
        'opening.color.walnut': 'ウォールナット', 'opening.color.grey': 'グレー', 'opening.color.black': 'ブラック',
        'opening.preset.window-fixed': 'FIX窓', 'opening.preset.window-casement': '縦すべり出し窓',
        'opening.preset.window-high': '高窓（スリット）',
        'opening.style.door.hinged': '片開き', 'opening.style.door.double': '両開き',
        'opening.style.door.sliding': '引き戸', 'opening.style.door.opening': '開口のみ（建具なし）',
        'opening.style.window.sliding': '引き違い', 'opening.style.window.fixed': 'FIX（はめ殺し）',
        'opening.style.window.casement': '縦すべり出し',

        'finish.floor': '床材', 'finish.wall': '壁紙', 'finish.scale': '柄の大きさ',
        'finish.scope.all': 'すべての壁', 'finish.scope.selected': '選択中の壁だけ',
        'finish.scope.hint': '間取りで壁をクリックすると、その壁だけ壁紙を変えられます',
        'finish.pasteHint': '「＋」から手持ちの床材・壁紙の写真も使えます',
        'finish.custom': '画像を使う', 'finish.customName': 'カスタム',
        'finish.preset.oak': 'オーク', 'finish.preset.hardMaple': 'メープル', 'finish.preset.ashClear': 'アッシュ',
        'finish.preset.sycamore': 'シカモア', 'finish.preset.elm': 'ニレ', 'finish.preset.acacia': 'アカシア',
        'finish.preset.blackCherry': 'チェリー', 'finish.preset.blackWalnut': 'ウォールナット',
        'finish.preset.standard': '白クロス', 'finish.preset.woven': '織物調', 'finish.preset.plaster': '塗り壁',
        'finish.preset.greige': 'グレージュ', 'finish.preset.sage': 'セージ', 'finish.preset.charcoal': 'チャコール',

        'gen.title': '写真から家具をつくる',
        'gen.drop.label': '家具の写真を選ぶ', 'gen.drop.title': '家具の写真をドロップ',
        'gen.drop.body': 'クリックで選択 · Ctrl+V で貼り付け', 'gen.drop.clear': '写真を外す',
        'dim.width': '幅', 'dim.depth': '奥行き', 'dim.height': '高さ',
        'gen.engine': '生成エンジン', 'gen.texture': 'テクスチャも生成',
        'gen.textureHint.optional': '色と質感を付けます。時間とGPUメモリを多く使います',
        'gen.textureHint.always': 'このエンジンは常に色付きで生成します',
        'gen.submit': '3Dモデルを生成',
        'gen.needImage': '先に家具の写真を選んでください', 'gen.badDims': '幅・奥行き・高さを正しく入力してください',
        'gen.noEngine': '使える生成エンジンがありません',

        'engine.state.ready': '準備完了', 'engine.state.starting': '読み込み中…', 'engine.state.busy': '生成中',
        'engine.state.stopped': '待機中', 'engine.state.stopping': '切り替え中…', 'engine.state.error': 'エラー',
        'engine.state.unconfigured': '未設定',
        'engine.desc.hunyuan3d': 'きれいな形状。テクスチャは任意（時間がかかります）',
        'engine.desc.trellis2': '高精細な形状とPBRマテリアル',
        'engine.desc.trellis': '速くて色付き',
        'engine.desc.mock': 'GPUなしで動作確認用の箱を返します',
        'engine.desc.pixal3d': '写真に忠実な形状とPBRテクスチャ（TRELLIS.2ベース）',
        'engine.desc.sam3d': '散らかった実写写真や一部が隠れた家具にも強い',
        'engine.switchNote': '選んだエンジンは生成時に自動で読み込まれ、ほかのエンジンはGPUから外れます',

        'api.offline': '生成APIに接続できません。別のターミナルで npm run api を実行してください。間取りと内装はこのまま使えます。',
        'api.unconfigured': '生成エンジンが設定されていません。.env にパスを書いてAPIを再起動してください（docs/engines.md）。',

        'jobs.title': '生成キュー',
        'job.queued': '順番待ち（{n}件目）', 'job.loading': '{engine} を読み込み中… 初回は数分かかります',
        'job.stage.preprocess': '背景を除去中', 'job.stage.shape': '形状を生成中',
        'job.stage.texture': 'テクスチャを生成中', 'job.stage.export': '書き出し中',
        'job.running': '生成中', 'job.placing': '部屋に配置中', 'job.done': '完了',
        'job.error': '失敗: {message}', 'job.dismiss': '閉じる', 'job.lost': 'APIが再起動したため、このジョブは失われました',

        'inspector.title': '選択中の家具', 'inspector.deselect': '選択を解除', 'inspector.name': '名前',
        'inspector.elevation': '床からの高さ', 'inspector.rotation': '向き',
        'inspector.edit': '形を調整', 'inspector.duplicate': '複製', 'inspector.delete': '削除',
        'inspector.size': '{w} × {d} × {h} cm',
        'inspector.fix': '向きを直す', 'inspector.fixHint': '上下逆や横倒しで生成されたときに使います。寸法は保ったまま床に置き直します',
        'inspector.tilt.flip': '上下反転', 'inspector.tilt.forward': '前に倒す', 'inspector.tilt.backward': '後ろに倒す',
        'inspector.tilt.left': '左に倒す', 'inspector.tilt.right': '右に倒す',
        'furniture.placed': '配置した家具',
        'furniture.empty': 'まだ家具はありません。写真から生成するか、保存したプロジェクトを開いてください。',
        'furniture.generating': '生成中…', 'furniture.failed': '生成に失敗',
        'furniture.defaultName': '家具 {number}', 'furniture.copyName': '{name} のコピー',

        'toast.generated': '「{name}」を部屋に置きました',
        'toast.textureFailed': 'テクスチャ生成に失敗したため、形状だけのモデルを置きました',
        'toast.textureUnavailable': 'このエンジンではテクスチャを生成できないため、形状だけのモデルを置きました',
        'toast.saved': 'プロジェクトを保存しました', 'toast.saveFailed': '保存できませんでした: {message}',
        'toast.opened': 'プロジェクトを開きました', 'toast.openPartial': 'プロジェクトを開きましたが、家具 {count} 点のモデルを読み込めませんでした',
        'toast.openFailed': '開けませんでした: {message}',
        'toast.projectMissing': 'ZIP に project.json がありません',
        'toast.loadFailed': '3Dモデルを読み込めませんでした',
        'toast.invalidImage': '画像ファイルを選んでください',
        'toast.deleted': '「{name}」を削除しました', 'toast.undo': '元に戻す',

        'edit.title': '形を調整', 'edit.overall': '全体の比率', 'edit.reset': 'リセット',
        'edit.partial': '部分的に変形', 'edit.hint': 'モデルをクリックで頂点を選択 · Shift+クリックで追加',
        'edit.radius': '範囲', 'edit.vertexCount': '{count} 頂点を選択中', 'edit.offset': '選択部分を移動',
        'edit.deselect': '選択を解除',
        'common.cancel': 'キャンセル', 'common.apply': '適用',
    },
    en: {
        'view.label': 'View', 'view.plan': 'Plan', 'view.room': '3D',
        'project.open': 'Open', 'project.save': 'Save',
        'language.label': 'Language', 'theme.toggle': 'Toggle light/dark',

        'plan.tools': 'Plan tools',
        'plan.tool.wall': 'Draw walls (W) — drag to draw, hold Shift to lock angles',
        'plan.tool.select': 'Select & move (V) — drag walls or corners',
        'plan.tool.erase': 'Erase (E) — click a wall to delete it',
        'plan.undo': 'Undo (Ctrl+Z)', 'plan.redo': 'Redo (Ctrl+Shift+Z)',
        'plan.fit': 'Fit to view (F)', 'plan.grid': 'Grid', 'plan.units': 'Units',
        'plan.empty.title': 'Start with the shape of your room',
        'plan.empty.body': 'Drag to draw walls, or pick a template on the right',
        'plan.hud': '{x}, {y} · {zoom}%',

        'room.camera.orbit': 'Overview', 'room.camera.top': 'From above', 'room.camera.inside': 'Eye level',
        'room.walls.solid': 'Show walls', 'room.walls.ghost': 'Cut away near walls', 'room.walls.hidden': 'Hide walls',
        'room.gizmo.move': 'Move furniture', 'room.gizmo.rotate': 'Rotate furniture', 'room.brightness': 'Brightness',
        'room.hint': 'Drag to orbit · right-drag to pan · scroll to zoom · click furniture to select',
        'room.empty.title': 'No room yet',
        'room.empty.body': 'Close the walls in the plan and the room appears here',

        'tab.lights': 'Lighting', 'lights.time': 'Time of day',
        'time.morning': 'Morning', 'time.day': 'Day', 'time.evening': 'Evening', 'time.night': 'Night',
        'lights.timeHint': 'By day the sun comes in through the windows; at night only your lights are on. See it in the 3D view',
        'lights.add': 'Add a light', 'lights.hint': 'Pick a type, then click the plan to place it. Drag it to move it afterwards',
        'lights.placed': 'Placed lights', 'lights.empty': 'No lights yet',
        'light.preset.ceiling': 'Ceiling light', 'light.preset.pendant': 'Pendant', 'light.preset.downlight': 'Downlight',
        'light.preset.spot': 'Spotlight', 'light.preset.floor': 'Floor lamp', 'light.preset.table': 'Table lamp',
        'light.on': 'On', 'light.lumens': 'Brightness', 'light.kelvin': 'Colour temperature',
        'light.drop': 'Below ceiling', 'light.height': 'Height',
        'light.shadows': 'Cast shadows', 'light.shadowsHint': 'Up to four lights can cast shadows at once',
        'light.preset.bulb': 'Light in furniture', 'light.inItem': 'Light in {name}',
        'light.attachedHint': 'A light inside this piece of furniture; it moves with it. Its position is an offset from the item',
        'light.orphaned': 'The furniture it was in is gone',
        'light.dx': 'Left/right', 'light.dz': 'Front/back',
        'inspector.addLight': 'Add a light source (lamps)',
        'light.kelvin.warm': 'warm', 'light.kelvin.warmWhite': 'warm white', 'light.kelvin.neutral': 'neutral', 'light.kelvin.daylight': 'daylight',
        'tab.room': 'Room', 'tab.finish': 'Finishes', 'tab.furniture': 'Furniture',
        'room.templates': 'Templates', 'room.template.rectangle': 'Rectangle', 'room.template.lShape': 'L-shape',
        'room.width': 'Width', 'room.depth': 'Depth', 'room.ceiling': 'Ceiling height',
        'room.walls': 'Walls', 'room.walls.empty': 'No walls yet',
        'room.summary': '{area} m² floor · {count} walls', 'room.summaryOpen': '{count} walls · room not closed',
        'room.clear': 'Clear everything', 'room.clearConfirm': 'Click again to remove all walls and furniture',
        'wall.item': 'Wall {number}', 'wall.delete': 'Delete this wall',
        'opening.title': 'Doors & windows', 'opening.hint': 'Pick a preset, then click a wall in the plan to place it. Drag it to move it afterwards.',
        'opening.style': 'Type', 'opening.sill': 'Sill height', 'opening.offset': 'Distance from wall end',
        'opening.flipHinge': 'Flip hinge side', 'opening.flipSide': 'Flip opening side', 'opening.flipSlide': 'Flip slide direction',
        'opening.open': 'How far open (3D view)',
        'opening.kind.door': 'Door', 'opening.kind.window': 'Window',
        'opening.preset.door-hinged': 'Hinged door', 'opening.preset.door-double': 'Double door',
        'opening.preset.door-sliding': 'Sliding door', 'opening.preset.door-opening': 'Open doorway',
        'opening.preset.window-sliding': 'Sliding window', 'opening.preset.window-patio': 'Patio window',
        'opening.preset.window-tall': 'Tall sliding window', 'opening.color': 'Door colour',
        'opening.color.white': 'White', 'opening.color.maple': 'Maple', 'opening.color.oak': 'Oak',
        'opening.color.walnut': 'Walnut', 'opening.color.grey': 'Grey', 'opening.color.black': 'Black',
        'opening.preset.window-fixed': 'Fixed window', 'opening.preset.window-casement': 'Casement window',
        'opening.preset.window-high': 'Clerestory slit',
        'opening.style.door.hinged': 'Hinged', 'opening.style.door.double': 'Double',
        'opening.style.door.sliding': 'Sliding', 'opening.style.door.opening': 'Opening only (no door)',
        'opening.style.window.sliding': 'Sliding', 'opening.style.window.fixed': 'Fixed',
        'opening.style.window.casement': 'Casement',

        'finish.floor': 'Flooring', 'finish.wall': 'Wallpaper', 'finish.scale': 'Pattern size',
        'finish.scope.all': 'All walls', 'finish.scope.selected': 'Selected wall only',
        'finish.scope.hint': 'Click a wall in the plan to give just that wall a different finish',
        'finish.pasteHint': 'Use “+” to bring your own flooring or wallpaper photo',
        'finish.custom': 'Use an image', 'finish.customName': 'Custom',
        'finish.preset.oak': 'Oak', 'finish.preset.hardMaple': 'Maple', 'finish.preset.ashClear': 'Ash',
        'finish.preset.sycamore': 'Sycamore', 'finish.preset.elm': 'Elm', 'finish.preset.acacia': 'Acacia',
        'finish.preset.blackCherry': 'Cherry', 'finish.preset.blackWalnut': 'Walnut',
        'finish.preset.standard': 'White vinyl', 'finish.preset.woven': 'Woven', 'finish.preset.plaster': 'Plaster',
        'finish.preset.greige': 'Greige', 'finish.preset.sage': 'Sage', 'finish.preset.charcoal': 'Charcoal',

        'gen.title': 'Furniture from a photo',
        'gen.drop.label': 'Choose a furniture photo', 'gen.drop.title': 'Drop a furniture photo',
        'gen.drop.body': 'Click to browse · Ctrl+V to paste', 'gen.drop.clear': 'Remove photo',
        'dim.width': 'Width', 'dim.depth': 'Depth', 'dim.height': 'Height',
        'gen.engine': 'Generation engine', 'gen.texture': 'Generate textures',
        'gen.textureHint.optional': 'Adds colour and material. Slower and uses more GPU memory',
        'gen.textureHint.always': 'This engine always produces coloured models',
        'gen.submit': 'Generate 3D model',
        'gen.needImage': 'Choose a furniture photo first', 'gen.badDims': 'Enter a valid width, depth and height',
        'gen.noEngine': 'No generation engine is available',

        'engine.state.ready': 'Ready', 'engine.state.starting': 'Loading…', 'engine.state.busy': 'Generating',
        'engine.state.stopped': 'Idle', 'engine.state.stopping': 'Switching…', 'engine.state.error': 'Error',
        'engine.state.unconfigured': 'Not set up',
        'engine.desc.hunyuan3d': 'Clean shapes; optional (slower) texturing',
        'engine.desc.trellis2': 'High-detail shapes with PBR materials',
        'engine.desc.trellis': 'Fast, coloured results',
        'engine.desc.mock': 'Returns a box, no GPU needed — for trying things out',
        'engine.desc.pixal3d': 'Shapes that follow the photo closely, with PBR textures (TRELLIS.2-based)',
        'engine.desc.sam3d': 'Copes with cluttered real-world photos and partly hidden furniture',
        'engine.switchNote': 'The chosen engine loads automatically when you generate; others are released from the GPU',

        'api.offline': 'Can’t reach the generation API. Run npm run api in another terminal. Planning and finishes keep working.',
        'api.unconfigured': 'No generation engine is set up. Add paths to .env and restart the API (see docs/engines.md).',

        'jobs.title': 'Generation queue',
        'job.queued': 'Waiting (#{n} in line)', 'job.loading': 'Loading {engine}… the first load can take minutes',
        'job.stage.preprocess': 'Removing background', 'job.stage.shape': 'Generating shape',
        'job.stage.texture': 'Painting textures', 'job.stage.export': 'Exporting',
        'job.running': 'Generating', 'job.placing': 'Placing in the room', 'job.done': 'Done',
        'job.error': 'Failed: {message}', 'job.dismiss': 'Dismiss', 'job.lost': 'The API restarted and this job was lost',

        'inspector.title': 'Selected furniture', 'inspector.deselect': 'Deselect', 'inspector.name': 'Name',
        'inspector.elevation': 'Elevation', 'inspector.rotation': 'Rotation',
        'inspector.edit': 'Adjust shape', 'inspector.duplicate': 'Duplicate', 'inspector.delete': 'Delete',
        'inspector.size': '{w} × {d} × {h} cm',
        'inspector.fix': 'Fix orientation', 'inspector.fixHint': 'For models generated upside down or on their side. Keeps the size and puts it back on the floor',
        'inspector.tilt.flip': 'Flip upside down', 'inspector.tilt.forward': 'Tip forward', 'inspector.tilt.backward': 'Tip back',
        'inspector.tilt.left': 'Tip left', 'inspector.tilt.right': 'Tip right',
        'furniture.placed': 'Placed furniture',
        'furniture.empty': 'No furniture yet. Generate some from a photo, or open a saved project.',
        'furniture.generating': 'Generating…', 'furniture.failed': 'Generation failed',
        'furniture.defaultName': 'Item {number}', 'furniture.copyName': '{name} copy',

        'toast.generated': 'Placed “{name}” in the room',
        'toast.textureFailed': 'Texturing failed, so the shape-only model was placed',
        'toast.textureUnavailable': 'This engine can’t texture, so the shape-only model was placed',
        'toast.saved': 'Project saved', 'toast.saveFailed': 'Couldn’t save: {message}',
        'toast.opened': 'Project opened', 'toast.openPartial': 'Project opened, but {count} furniture model(s) could not be loaded',
        'toast.openFailed': 'Couldn’t open: {message}',
        'toast.projectMissing': 'The ZIP has no project.json',
        'toast.loadFailed': 'Couldn’t load the 3D model',
        'toast.invalidImage': 'Choose an image file',
        'toast.deleted': 'Deleted “{name}”', 'toast.undo': 'Undo',

        'edit.title': 'Adjust shape', 'edit.overall': 'Overall proportions', 'edit.reset': 'Reset',
        'edit.partial': 'Local deformation', 'edit.hint': 'Click the model to pick vertices · Shift+click to add',
        'edit.radius': 'Radius', 'edit.vertexCount': '{count} vertices selected', 'edit.offset': 'Move selection',
        'edit.deselect': 'Clear selection',
        'common.cancel': 'Cancel', 'common.apply': 'Apply',
    },
};

const STORAGE_KEY = 'room-setup.language';

export function resolveLanguage(saved, browserLanguage = 'en') {
    if (saved === 'ja' || saved === 'en') return saved;
    return String(browserLanguage).toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function translate(locale, key, params = {}) {
    const template = messages[locale]?.[key] ?? messages.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}

let saved;
try { saved = globalThis.localStorage?.getItem(STORAGE_KEY); } catch { /* storage disabled */ }
let language = resolveLanguage(saved, globalThis.navigator?.language);

export const getLanguage = () => language;
export const t = (key, params) => translate(language, key, params);

export function setLanguage(next) {
    language = resolveLanguage(next);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, language); } catch { /* still switches */ }
}

export function applyTranslations(root = document) {
    for (const element of root.querySelectorAll('[data-i18n]')) {
        element.textContent = t(element.dataset.i18n);
    }
    for (const attr of ['title', 'aria-label', 'alt', 'placeholder']) {
        for (const element of root.querySelectorAll(`[data-i18n-${attr}]`)) {
            element.setAttribute(attr, t(element.getAttribute(`data-i18n-${attr}`)));
        }
    }
}
