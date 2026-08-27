import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// No credentials are needed. This scans working files, not Git history.
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  ".pnpm-store",
  ".npm-cache",
  ".turbo",
  ".cache",
  "out",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  ".venv",
  "__pycache__",
]);
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".zip",
  ".gz",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
]);
const sourceExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".html",
  ".css",
  ".scss",
  ".sh",
  ".ps1",
  ".txt",
  ".toml",
  ".xml",
  ".svg",
  ".ini",
  ".cfg",
  ".pem",
  ".key",
]);
const maxTextBytes = 2 * 1024 * 1024;
const red = "\u001b[31m";
const reset = "\u001b[0m";

const rules = [
  {
    id: "private-key",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: "pgp-private-key",
    pattern: /-----BEGIN PGP[ ]PRIVATE KEY BLOCK-----/g,
  },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  {
    id: "github-fine-grained-token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  },
  {
    id: "openai-style-secret",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g,
  },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g },
  {
    id: "stripe-secret",
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  { id: "vercel-token", pattern: /\b(?:vercel|vcp)_[A-Za-z0-9_-]{20,}\b/g },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  {
    id: "jwt-token",
    pattern:
      /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: "credential-in-url",
    pattern:
      /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:@]+:[^\s/@]{8,}@/g,
  },
  {
    id: "hardcoded-secret",
    pattern:
      /\b(?:[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)|api[_-]?key|(?:access|auth|refresh)[_-]?token|client[_-]?secret|password|secret|token|private[_-]?key)["']?\s*[:=]\s*(?:"([^"\r\n]{12,})"|'([^'\r\n]{12,})'|([A-Za-z0-9+/_=.-]{20,}))/gi,
    isPlaceholder: (match) => {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      return /^(?:<[^>]+>|\$\{[^}]+\}|(?:process|import\.meta)\.env\.[A-Za-z0-9_]+|(?:your|replace_with|example|sample|dummy|placeholder|changeme)[_ -][A-Za-z0-9_-]+|x{6,}|0{6,})$/i.test(
        value,
      );
    },
  },
];

export function isUnsafeEnvFile(name) {
  const environmentFile = /^(?:\.env(?:[._-].*)?|\.envrc)$/i.test(name);
  const templateFile = /\.(?:example|sample|template)$/i.test(name);
  return environmentFile && !templateFile;
}

// Findings deliberately contain no matched strings or source excerpts.
export function scanText(source) {
  const findings = [];
  const seen = new Set();
  for (const rule of rules) {
    for (const match of source.matchAll(rule.pattern)) {
      if (rule.isPlaceholder?.(match)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      const key = `${rule.id}:${line}`;
      if (!seen.has(key)) {
        findings.push({ rule: rule.id, line });
        seen.add(key);
      }
    }
  }
  return findings;
}

export async function scanRepository(directory = process.cwd()) {
  const root = resolve(directory);
  const findings = [];
  let scannedFiles = 0;
  let skippedBinaryFiles = 0;
  const report = (file, rule, line = 1) => {
    findings.push({
      file: relative(root, file).split("\\").join("/"),
      rule,
      line,
    });
  };

  async function visit(directoryPath) {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      report(directoryPath, "directory-unreadable");
      return;
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (ignoredDirectories.has(entry.name)) continue;
      const path = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        // Do not follow links outside the repository, or silently treat them as safe.
        report(path, "symlink-requires-review");
        continue;
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith(".tsbuildinfo")) continue;
      if (isUnsafeEnvFile(entry.name)) report(path, "unsafe-environment-file");
      if (
        /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$|\.(?:p12|pfx|jks|keystore)$/i.test(
          entry.name,
        )
      ) {
        report(path, "private-key-container");
      }
      if (binaryExtensions.has(extname(entry.name).toLowerCase())) {
        skippedBinaryFiles += 1;
        continue;
      }
      try {
        const stats = await lstat(path);
        if (stats.isSymbolicLink()) {
          report(path, "symlink-requires-review");
          continue;
        }
        if (stats.size > maxTextBytes) {
          report(path, "text-file-too-large-to-scan");
          continue;
        }
        const buffer = await readFile(path);
        if (buffer.includes(0)) {
          if (
            sourceExtensions.has(extname(entry.name).toLowerCase()) ||
            basename(path).startsWith(".env")
          ) {
            report(path, "binary-content-in-source");
          }
          skippedBinaryFiles += 1;
          continue;
        }
        scannedFiles += 1;
        for (const finding of scanText(buffer.toString("utf8"))) {
          report(path, finding.rule, finding.line);
        }
      } catch {
        report(path, "file-unreadable");
      }
    }
  }

  await visit(root);
  return { findings, scannedFiles, skippedBinaryFiles };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const result = await scanRepository();
    if (result.findings.length > 0) {
      console.error(
        `${red}Secret scan failed: ${result.findings.length} finding(s). Values are redacted.${reset}`,
      );
      for (const finding of result.findings) {
        console.error(
          `${red}${finding.file}:${finding.line} [${finding.rule}]${reset}`,
        );
      }
      process.exitCode = 1;
    } else {
      console.log(
        `Secret scan passed: ${result.scannedFiles} text files checked; ${result.skippedBinaryFiles} binary assets skipped. No known secret patterns found.`,
      );
      console.log(
        "Scope: working files only. Dependency/build directories and Git history are excluded.",
      );
    }
  } catch {
    console.error(
      `${red}Secret scan could not complete. No source contents were printed.${reset}`,
    );
    process.exitCode = 1;
  }
}
