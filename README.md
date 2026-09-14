# Mogu-Mogu Match

食の好みを4つの軸で診断し、友達との相性やグループでのお店選びに活用できるWebサイトです。

## 構成

- `outputs/`: Cloudflare Pagesへ配信する静的ファイル
- `functions/`: Cloudflare Pages Functions API
- `posts/`: 「作者の独り言」のMarkdown記事
- `scripts/`: ブログ生成とAPIテスト
- `assets/`: ビルド元の共有アセット
- `schema.sql`: D1データベースのスキーマ

## 開発

Node.jsを用意し、依存関係をインストールします。

```bash
npm install
npm run build
```

`outputs/`を任意の静的HTTPサーバーで開くと、ローカルで画面を確認できます。

```bash
npx serve outputs
```

## テスト

```bash
npm run test:api
```

## Cloudflare Pages

初回は`wrangler.toml`のD1データベースIDを利用環境の値に設定し、Cloudflare側のバインディングを確認してください。

```bash
npm run deploy
```

詳しい本番設定は [`CLOUDFLARE_PRODUCTION.md`](CLOUDFLARE_PRODUCTION.md)、ブログ記事の追加方法は [`BLOG_POSTS_README.md`](BLOG_POSTS_README.md) を参照してください。

## アセットについて

モグキャラの画像とブランド素材は本プロジェクト専用です。第三者による再利用・再配布を許諾するものではありません。
