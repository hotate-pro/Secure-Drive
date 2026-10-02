# Secure Drive

カード + 顔認証を入口にする、ローカルファーストなSecure Driveの基礎実装。

## V0.1

- QRカード発行・読み取り
- カードIDはランダム値。個人情報をQRに入れない
- YuNetによる顔検出 + 5点ランドマーク
- ArcFace MobileFaceNet (w600k_mbf) による512次元顔特徴量
- WebGPU優先、WASMフォールバック
- 顔特徴量とカードハッシュをAES-GCMでIndexedDBに保存
- 初回ユーザーをAdminとして登録
- 3段階のランダム頭部向きチャレンジによる簡易ライブネス
- 認証ログを端末内に保存
- 実行時の外部CDN依存なし

## 起動

```bash
npm install
npm run models
npm run dev
```

モデル取得後、

```
public/models/yunet.onnx
public/models/arcface_mbf.onnx
```

が存在する状態で起動する。

### 本番ビルド

```bash
npm run build
npm run preview
```

カメラ・WebGPUを安定して使うため、HTTPSまたはlocalhostで実行する。

## モデルについて

YuNetはOpenCV Zoo由来の軽量顔検出モデル。ArcFaceはInsightFace buffalo_scのw600k_mbfを使用する。

InsightFaceの公開事前学習モデルには利用条件があるため、これはプロトタイプ用途として扱う。商用化する場合はモデルの利用許諾を確認し、必要なら商用利用可能な認識モデルへ差し替える。

## セキュリティ上の重要事項

このV0.1は「認証UI + ローカル認証基盤」のプロトタイプであり、ブラウザ上のIndexedDBを絶対的なセキュリティ境界にはしていない。

PCを完全に掌握している攻撃者は、ブラウザデータやアプリコードを改変できる。そのため、最終的なGoogle Driveの機密データ保護では、

1. Google OAuth
2. Drive APIの実権限
3. サーバー側または暗号鍵側の認可
4. カード + 顔認証

を組み合わせる。

顔画像そのものは保存せず、特徴量だけを保存する。実運用では本人の同意・学校等のルール・保存期間も確認する。

## 次の実装

V0.1が実機で安定したら、認証成功イベントをDrive UIへ接続する。

- Google OAuth
- Drive API
- フォルダ表示
- フォルダ作成
- アップロード
- ダウンロード
- 移動
- 削除
- 名前変更
- 更新日時・サイズ表示
