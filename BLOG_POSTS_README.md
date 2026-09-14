# 「作者の独り言」記事の追加方法

記事は管理画面ではなく、リポジトリ内のMarkdownファイルとして管理します。公開サイトに管理者パスワードや投稿フォームは置きません。

## 記事を追加する

1. `posts/` に `YYYY-MM-DD-slug.md` 形式のファイルを作成します。
2. ファイル先頭に `id`、`title`、`date` を書きます。アイキャッチ画像を使う場合だけ `image` も追加します。
3. フロントマターの下にMarkdownで本文を書きます。
4. 新しい画像は `assets/blog/` に置き、`image: /assets/blog/example.jpg` のように指定します。
5. 変更をコミットし、`npm run deploy` で再デプロイします。

```markdown
---
id: 20260812-example
title: 記事タイトル
date: 2026-08-12
image: /assets/blog/example.jpg
---

## 見出し

ここから本文を書きます。
```

`id` は将来のいいね機能で記事を識別するキーになります。一度公開した記事の `id` は変更しないでください。`date` はファイル名の日付と一致させます。

## ビルドとデプロイ

`npm run build` は次の処理を自動で行います。

- `posts/*.md` を検証する
- 記事を新しい順に並べた `outputs/posts/index.json` を生成する
- Markdownと `assets/blog/` の画像を公開用の `outputs/` にコピーする

Cloudflare PagesのGit連携を使う場合は、ビルドコマンドを `npm run build`、出力ディレクトリを `outputs` に設定してください。手動デプロイでは `npm run deploy` を実行すると、ブログ生成後にWranglerで公開します。
