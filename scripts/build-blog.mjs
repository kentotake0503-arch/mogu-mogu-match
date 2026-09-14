import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourcePostsDirectory = path.join(projectRoot, "posts");
const outputPostsDirectory = path.join(projectRoot, "outputs", "posts");
const sourceBlogAssetsDirectory = path.join(projectRoot, "assets", "blog");
const outputBlogAssetsDirectory = path.join(projectRoot, "outputs", "assets", "blog");
const sourceVendorDirectory = path.join(projectRoot, "vendor");
const outputVendorDirectory = path.join(projectRoot, "outputs", "vendor");
const fileNamePattern = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/i;

function parseFrontMatter(source, fileName) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${fileName}: YAMLフロントマターが見つかりません`);

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${fileName}: フロントマターの形式が正しくありません: ${line}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }

  for (const required of ["id", "title", "date"]) {
    if (!metadata[required]) throw new Error(`${fileName}: ${required} は必須です`);
  }

  return { metadata, body: match[2].trim() };
}

function markdownToExcerpt(markdown, maxLength = 150) {
  const plainText = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*(?:[-*+] |\d+\.\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plainText.length > maxLength ? `${plainText.slice(0, maxLength).trimEnd()}...` : plainText;
}

async function directoryExists(directory) {
  try {
    await readdir(directory);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function buildBlog() {
  await mkdir(sourcePostsDirectory, { recursive: true });
  await rm(outputPostsDirectory, { recursive: true, force: true });
  await mkdir(outputPostsDirectory, { recursive: true });

  const sourceFiles = (await readdir(sourcePostsDirectory))
    .filter(fileName => fileName.toLowerCase().endsWith(".md"))
    .sort();
  const posts = [];
  const ids = new Set();

  for (const fileName of sourceFiles) {
    const nameMatch = fileName.match(fileNamePattern);
    if (!nameMatch) {
      throw new Error(`${fileName}: ファイル名は YYYY-MM-DD-slug.md の形式にしてください`);
    }

    const sourcePath = path.join(sourcePostsDirectory, fileName);
    const source = await readFile(sourcePath, "utf8");
    const { metadata, body } = parseFrontMatter(source, fileName);
    const [slug, fileDate] = [fileName.slice(0, -3), nameMatch[1]];

    if (metadata.date !== fileDate) {
      throw new Error(`${fileName}: date はファイル名の日付 ${fileDate} と一致させてください`);
    }
    if (ids.has(metadata.id)) throw new Error(`${fileName}: id ${metadata.id} が重複しています`);
    ids.add(metadata.id);

    posts.push({
      id: metadata.id,
      title: metadata.title,
      date: metadata.date,
      image: metadata.image || null,
      slug,
      file: `/posts/${fileName}`,
      excerpt: markdownToExcerpt(body)
    });
    await writeFile(path.join(outputPostsDirectory, fileName), source, "utf8");
  }

  posts.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
  await writeFile(path.join(outputPostsDirectory, "index.json"), `${JSON.stringify(posts, null, 2)}\n`, "utf8");

  await rm(outputBlogAssetsDirectory, { recursive: true, force: true });
  if (await directoryExists(sourceBlogAssetsDirectory)) {
    await mkdir(outputBlogAssetsDirectory, { recursive: true });
    await cp(sourceBlogAssetsDirectory, outputBlogAssetsDirectory, { recursive: true });
  }

  await rm(outputVendorDirectory, { recursive: true, force: true });
  if (await directoryExists(sourceVendorDirectory)) {
    await cp(sourceVendorDirectory, outputVendorDirectory, { recursive: true });
  }

  console.log(`Blog build complete: ${posts.length} post(s)`);
}

buildBlog().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
