import difflib
import re
import secrets
import threading
import unicodedata
from datetime import datetime
from pathlib import Path

from .providers import ImageProvider, ProviderError, TextProvider


PRESET_DETAILS = {
    "hand-drawn-edu": {
        "type": "infographic",
        "style": "sketch-notes",
        "palette": "macaron",
        "description": "hand-drawn educational infographic with warm paper and pastel blocks",
    },
    "minimal-flat": {
        "type": "infographic",
        "style": "minimal-flat",
        "palette": "default",
        "description": "clean flat vector knowledge illustration",
    },
    "sci-fi-blueprint": {
        "type": "framework",
        "style": "blueprint",
        "palette": "default",
        "description": "technical blueprint for AI and systems topics",
    },
    "editorial-flow": {
        "type": "flowchart",
        "style": "editorial",
        "palette": "default",
        "description": "editorial process visualization",
    },
}


def slugify(value, fallback="illustration"):
    value = unicodedata.normalize("NFKD", value or "")
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:64] or fallback


def density_to_count(density, heading_count):
    if density == "minimal":
        return 2
    if density == "per-section":
        return max(1, min(8, heading_count or 3))
    if density == "rich":
        return max(6, min(10, (heading_count or 5) + 2))
    return 4


def extract_markdown_structure(content):
    lines = content.splitlines()
    headings = []
    paragraphs = []
    current = []
    in_code = False

    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code = not in_code
            continue
        if in_code:
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", stripped)
        if heading:
            headings.append({"level": len(heading.group(1)), "title": heading.group(2), "line": index})
            if current:
                paragraphs.append({"text": " ".join(current), "line": index})
                current = []
            continue
        if not stripped:
            if current:
                paragraphs.append({"text": " ".join(current), "line": index})
                current = []
            continue
        if stripped.startswith(("!", "|", ">", "-", "*", "+")) or re.match(r"^\d+\.", stripped):
            continue
        current.append(stripped)

    if current:
        paragraphs.append({"text": " ".join(current), "line": len(lines)})

    return {
        "headings": headings,
        "paragraphs": paragraphs,
        "word_count": len(re.findall(r"\w+", content)),
    }


def detect_language(content):
    sample = content[:2000]
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", sample))
    latin_count = len(re.findall(r"[A-Za-z]", sample))
    return "zh-CN" if cjk_count > latin_count / 2 else "en"


def fallback_analysis(content, settings):
    structure = extract_markdown_structure(content)
    headings = structure["headings"]
    paragraphs = structure["paragraphs"]
    density = settings.get("default_density", "balanced")
    target_count = density_to_count(density, len(headings))
    preset = settings.get("default_preset", "hand-drawn-edu")
    preset_detail = PRESET_DETAILS.get(preset, PRESET_DETAILS["hand-drawn-edu"])

    illustrations = []
    if headings:
        selected = headings[:target_count]
        for index, heading in enumerate(selected, start=1):
            title = heading["title"]
            illustrations.append(
                {
                    "position_heading": title,
                    "after_paragraph": index,
                    "type": preset_detail["type"],
                    "purpose": f"Visualize the key idea in {title}",
                    "visual_content": f"A concise {preset_detail['description']} explaining {title}",
                    "title": title,
                    "labels": [title, "Key idea", "Takeaway"],
                    "slug": slugify(title, f"section-{index}"),
                }
            )
    else:
        title = paragraphs[0]["text"][:40] if paragraphs else "Article Overview"
        illustrations.append(
            {
                "position_heading": "",
                "after_paragraph": 1,
                "type": preset_detail["type"],
                "purpose": "Summarize the article's central idea",
                "visual_content": f"A concise {preset_detail['description']} explaining the article's main idea",
                "title": title,
                "labels": ["Main idea", "Context", "Takeaway"],
                "slug": "article-overview",
            }
        )

    return {
        "content_type": "Methodology",
        "purpose": "visualization",
        "core_arguments": [item["title"] for item in illustrations[:5]],
        "recommended_preset": preset,
        "recommended_density": density,
        "language": detect_language(content),
        "illustrations": illustrations[:target_count],
        "structure": structure,
    }


def analyze_article(content, settings):
    system_prompt = (
        "You analyze Markdown articles and return strict JSON for illustration planning. "
        "Do not recommend decorative images. Visualize underlying concepts, processes, comparisons, data, or frameworks."
    )
    user_prompt = f"""
Return JSON with keys:
content_type, purpose, core_arguments, recommended_preset, recommended_density, language, illustrations.
Each illustration must include: position_heading, after_paragraph, type, purpose, visual_content, title, labels, slug.
Use at most {density_to_count(settings.get('default_density'), len(extract_markdown_structure(content)['headings']))} illustrations.
Preferred preset: {settings.get('default_preset')}.
Preferred density: {settings.get('default_density')}.

Markdown:
{content[:16000]}
"""
    try:
        analysis = TextProvider(settings).complete_json(system_prompt, user_prompt)
        if not isinstance(analysis.get("illustrations"), list) or not analysis["illustrations"]:
            raise ProviderError("Text provider returned no illustrations")
        analysis["structure"] = extract_markdown_structure(content)
        return normalize_analysis(analysis, settings)
    except Exception as exc:
        analysis = fallback_analysis(content, settings)
        analysis["provider_warning"] = str(exc)
        return analysis


def normalize_analysis(analysis, settings):
    preset = analysis.get("recommended_preset") or settings.get("default_preset", "hand-drawn-edu")
    density = analysis.get("recommended_density") or settings.get("default_density", "balanced")
    structure = analysis.get("structure") or {"headings": []}
    max_count = density_to_count(density, len(structure.get("headings", [])))
    normalized = dict(analysis)
    normalized["recommended_preset"] = preset
    normalized["recommended_density"] = density
    normalized["language"] = analysis.get("language") or "zh-CN"
    normalized["illustrations"] = []
    for index, item in enumerate((analysis.get("illustrations") or [])[:max_count], start=1):
        title = item.get("title") or item.get("position_heading") or f"Illustration {index}"
        normalized["illustrations"].append(
            {
                "position_heading": item.get("position_heading", ""),
                "after_paragraph": int(item.get("after_paragraph") or index),
                "type": item.get("type") or PRESET_DETAILS.get(preset, PRESET_DETAILS["hand-drawn-edu"])["type"],
                "purpose": item.get("purpose") or "Support reader understanding",
                "visual_content": item.get("visual_content") or title,
                "title": title,
                "labels": item.get("labels") if isinstance(item.get("labels"), list) else [title],
                "slug": slugify(item.get("slug") or title, f"illustration-{index}"),
            }
        )
    return normalized


def resolve_output_dir(article_path, output_dir_setting):
    article_path = Path(article_path)
    if output_dir_setting == "same-dir":
        return article_path.parent, ""
    if output_dir_setting == "illustrations-subdir":
        return article_path.parent / "illustrations", "illustrations"
    if output_dir_setting == "independent":
        topic = slugify(article_path.stem, "article")
        return article_path.parent / "illustrations" / topic, f"illustrations/{topic}"
    return article_path.parent / "imgs", "imgs"


def build_prompt(illustration, settings, preset):
    preset_detail = PRESET_DETAILS.get(preset, PRESET_DETAILS["hand-drawn-edu"])
    labels = ", ".join(str(label) for label in illustration.get("labels", [])[:8])
    language = settings.get("language") or "match article"
    return f"""---
illustration_id: {illustration['id']}
type: {illustration['type']}
style: {preset_detail['style']}
palette: {preset_detail['palette']}
---

{illustration['title']} - Article Illustration

PURPOSE:
{illustration['purpose']}

VISUAL CONTENT:
{illustration['visual_content']}

LAYOUT:
- Single-page {preset_detail['description']}.
- Clean composition with generous white space.
- Main elements centered or positioned by content needs.
- Use clear visual hierarchy, with one central idea and supporting zones.

LABELS:
{labels}

TEXT RULES:
- Text should be large and prominent with handwritten-style fonts when suitable.
- Keep minimal, focus on keywords.
- Match article language: {language}.
- Do not display color names, hex codes, or palette labels as visible text.

STYLE:
{preset_detail['style']} with {preset_detail['palette']} palette. Diagram-style visuals only, no photorealistic images.

ASPECT: 16:9
"""


def prepare_assets(article_path, settings, analysis):
    article_path = Path(article_path)
    output_dir, markdown_prefix = resolve_output_dir(article_path, settings.get("default_output_dir", "imgs-subdir"))
    prompts_dir = output_dir / "prompts"
    prompts_dir.mkdir(parents=True, exist_ok=True)

    preset = settings.get("preset") or analysis.get("recommended_preset") or settings.get("default_preset")
    illustrations = []
    for index, item in enumerate(analysis.get("illustrations", []), start=1):
        image_type = item.get("type", "infographic")
        slug = slugify(item.get("slug") or item.get("title"), f"illustration-{index}")
        filename = f"{index:02d}-{image_type}-{slug}.png"
        prompt_filename = f"{index:02d}-{image_type}-{slug}.md"
        illustration = dict(item)
        illustration.update(
            {
                "id": f"{index:02d}",
                "filename": filename,
                "prompt_filename": prompt_filename,
                "image_path": str(output_dir / filename),
                "prompt_path": str(prompts_dir / prompt_filename),
                "markdown_path": f"{markdown_prefix}/{filename}" if markdown_prefix else filename,
            }
        )
        prompt = build_prompt(illustration, settings, preset)
        Path(illustration["prompt_path"]).write_text(prompt, encoding="utf-8")
        illustration["prompt"] = prompt
        illustrations.append(illustration)

    outline = build_outline(analysis, illustrations, settings)
    (output_dir / "outline.md").write_text(outline, encoding="utf-8")
    return {"output_dir": str(output_dir), "outline_path": str(output_dir / "outline.md"), "illustrations": illustrations}


def build_outline(analysis, illustrations, settings):
    lines = [
        "---",
        f"preset: {settings.get('preset') or analysis.get('recommended_preset')}",
        f"density: {settings.get('density') or analysis.get('recommended_density')}",
        f"image_count: {len(illustrations)}",
        "---",
        "",
    ]
    for item in illustrations:
        lines.extend(
            [
                f"## Illustration {item['id']}",
                f"**Position**: {item.get('position_heading') or 'Article body'}",
                f"**Purpose**: {item.get('purpose')}",
                f"**Visual Content**: {item.get('visual_content')}",
                f"**Filename**: {item.get('filename')}",
                "",
            ]
        )
    return "\n".join(lines)


def insert_images(content, illustrations):
    lines = content.splitlines()
    insertions = []
    for item in illustrations:
        heading = item.get("position_heading")
        insert_at = None
        if heading:
            for index, line in enumerate(lines):
                if re.match(r"^#{1,6}\s+", line) and heading.strip() in line:
                    insert_at = find_paragraph_end(lines, index + 1)
                    break
        if insert_at is None:
            paragraph_index = max(1, int(item.get("after_paragraph") or 1))
            insert_at = find_nth_paragraph_end(lines, paragraph_index)
        insertions.append((insert_at, item))

    for insert_at, item in sorted(insertions, key=lambda pair: pair[0], reverse=True):
        markdown = f"![{item.get('title', 'Illustration')}]({item['markdown_path']})"
        block = ["", markdown, ""]
        lines[insert_at:insert_at] = block
    return "\n".join(lines).rstrip() + "\n"


def find_paragraph_end(lines, start):
    for index in range(start, len(lines)):
        if lines[index].strip() == "":
            return index + 1
    return len(lines)


def find_nth_paragraph_end(lines, paragraph_number):
    count = 0
    in_paragraph = False
    in_code = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code = not in_code
        if in_code:
            continue
        if stripped and not stripped.startswith("#"):
            in_paragraph = True
        elif in_paragraph:
            count += 1
            in_paragraph = False
            if count >= paragraph_number:
                return index + 1
    return len(lines)


def preview_diff(original, updated):
    return "\n".join(
        difflib.unified_diff(
            original.splitlines(),
            updated.splitlines(),
            fromfile="current",
            tofile="illustrated",
            lineterm="",
        )
    )


class ArticleIllustratorService:
    def __init__(self, settings_store, job_store, path_validator, config_defaults=None):
        self.settings_store = settings_store
        self.job_store = job_store
        self.path_validator = path_validator
        self.config_defaults = config_defaults or {}

    def analyze(self, article_path, overrides=None):
        article_path = Path(article_path).expanduser().resolve()
        self._validate_article(article_path)
        settings = self._settings(overrides)
        content = article_path.read_text(encoding="utf-8")
        return analyze_article(content, settings)

    def create_job(self, article_path, overrides=None, analysis=None):
        article_path = Path(article_path).expanduser().resolve()
        self._validate_article(article_path)
        settings = self._settings(overrides)
        if analysis is None:
            content = article_path.read_text(encoding="utf-8")
            analysis = analyze_article(content, settings)
        job_id = secrets.token_urlsafe(12)
        self.job_store.create(job_id, str(article_path), settings, analysis)
        thread = threading.Thread(target=self._run_job, args=(job_id,), daemon=True)
        thread.start()
        return job_id

    def _run_job(self, job_id):
        job = self.job_store.get(job_id)
        if not job:
            return
        article_path = Path(job["path"])
        settings = job["settings"]
        analysis = job["analysis"]
        try:
            self.job_store.update(job_id, status="running", progress=5, message="Preparing prompts")
            self.job_store.log(job_id, "Preparing outline and prompt files")
            assets = prepare_assets(article_path, settings, analysis)
            self.job_store.update(job_id, progress=20, result_json=assets)

            provider = ImageProvider(settings)
            illustrations = assets["illustrations"]
            for index, item in enumerate(illustrations, start=1):
                if self.job_store.is_cancel_requested(job_id):
                    self.job_store.update(job_id, status="cancelled", progress=100, message="Cancelled")
                    self.job_store.log(job_id, "Cancelled")
                    return
                self.job_store.log(job_id, f"Generating {item['filename']}")
                prompt = Path(item["prompt_path"]).read_text(encoding="utf-8")
                attempts = settings.get("retry_count", 1) + 1
                last_error = None
                for attempt in range(1, attempts + 1):
                    try:
                        provider.generate(prompt, Path(item["image_path"]), aspect_ratio="16:9")
                        last_error = None
                        break
                    except Exception as exc:
                        last_error = exc
                        self.job_store.log(job_id, f"Attempt {attempt} failed for {item['filename']}: {exc}")
                if last_error:
                    raise last_error
                progress = 20 + int(index / max(1, len(illustrations)) * 65)
                self.job_store.update(job_id, progress=progress, result_json=assets)

            original = article_path.read_text(encoding="utf-8")
            updated = insert_images(original, illustrations)
            result = dict(assets)
            result["preview_markdown"] = updated
            result["diff"] = preview_diff(original, updated)
            self.job_store.update(job_id, status="completed", progress=100, message="Completed", result_json=result)
            self.job_store.log(job_id, "Completed")
        except Exception as exc:
            self.job_store.update(job_id, status="failed", error=str(exc), message="Failed")
            self.job_store.log(job_id, f"Failed: {exc}")

    def preview(self, job_id):
        job = self.job_store.get(job_id)
        if not job:
            return None
        result = job.get("result") or {}
        if not result.get("preview_markdown") and result.get("illustrations"):
            article_path = Path(job["path"])
            original = article_path.read_text(encoding="utf-8")
            updated = insert_images(original, result["illustrations"])
            result["preview_markdown"] = updated
            result["diff"] = preview_diff(original, updated)
        return result

    def apply(self, job_id):
        job = self.job_store.get(job_id)
        if not job:
            return None
        if job["status"] != "completed":
            raise ValueError("Job is not completed")
        article_path = Path(job["path"])
        self._validate_article(article_path)
        result = self.preview(job_id)
        updated = result.get("preview_markdown")
        if not updated:
            raise ValueError("No preview markdown available")
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = article_path.with_name(f"{article_path.stem}.backup-{timestamp}{article_path.suffix}")
        original = article_path.read_text(encoding="utf-8")
        backup_path.write_text(original, encoding="utf-8")
        article_path.write_text(updated, encoding="utf-8")
        result["applied"] = True
        result["backup_path"] = str(backup_path)
        self.job_store.update(job_id, result_json=result, message="Applied to article")
        self.job_store.log(job_id, f"Applied to article, backup: {backup_path.name}")
        return {"success": True, "backup_path": str(backup_path)}

    def test_settings(self, settings=None):
        settings = self._settings(settings)
        text = TextProvider(settings).test()
        image = ImageProvider(settings).test()
        return {"text": text, "image": image, "ok": bool(text.get("ok") and image.get("ok"))}

    def _settings(self, overrides=None):
        settings = self.settings_store.load(self.config_defaults)
        if overrides:
            for key, value in overrides.items():
                if value not in (None, ""):
                    settings[key] = value
        if "preset" in settings and not settings.get("default_preset"):
            settings["default_preset"] = settings["preset"]
        if overrides and overrides.get("preset"):
            settings["default_preset"] = overrides["preset"]
        if overrides and overrides.get("density"):
            settings["default_density"] = overrides["density"]
        return settings

    def _validate_article(self, article_path):
        if not self.path_validator(article_path):
            raise PermissionError("无权限访问该文件")
        if not article_path.exists() or not article_path.is_file():
            raise FileNotFoundError("文件不存在")
        if article_path.suffix.lower() != ".md":
            raise ValueError("只支持 Markdown 文件")
