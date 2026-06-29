import base64
import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


class ProviderError(RuntimeError):
    pass


def _post_json(url, payload, api_key=None, timeout=120):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    data = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=data, headers=headers, method="POST")
    try:
        with urlrequest.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ProviderError(f"Provider HTTP {exc.code}: {detail[:500]}") from exc
    except URLError as exc:
        raise ProviderError(f"Provider connection failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise ProviderError("Provider returned invalid JSON") from exc


class TextProvider:
    def __init__(self, settings):
        self.settings = settings

    def complete_json(self, system_prompt, user_prompt):
        provider = self.settings.get("text_provider")
        if provider == "mock":
            return self._mock_analysis(user_prompt)
        if provider not in ("openai", "openai-compatible"):
            raise ProviderError(f"Unsupported text provider: {provider}")

        api_key = os.environ.get(self.settings.get("text_api_key_env", ""))
        if not api_key:
            raise ProviderError("Text API key environment variable is not available")

        base_url = self.settings.get("text_base_url", "https://api.openai.com/v1").rstrip("/")
        response = _post_json(
            f"{base_url}/chat/completions",
            {
                "model": self.settings.get("text_model"),
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
            api_key=api_key,
            timeout=self.settings.get("timeout_seconds", 120),
        )
        content = response["choices"][0]["message"]["content"]
        return json.loads(content)

    def test(self):
        provider = self.settings.get("text_provider")
        if provider == "mock":
            return {"ok": True, "message": "Mock text provider is available"}
        if provider in ("openai", "openai-compatible"):
            api_key_env = self.settings.get("text_api_key_env", "")
            if not os.environ.get(api_key_env):
                return {"ok": False, "message": f"Missing environment variable: {api_key_env}"}
            return {"ok": True, "message": "Text provider configuration looks valid"}
        return {"ok": False, "message": f"Unsupported text provider: {provider}"}

    def _mock_analysis(self, user_prompt):
        return {
            "content_type": "Methodology",
            "purpose": "visualization",
            "core_arguments": [
                "文章需要用结构化视觉帮助读者把握主线",
                "配图应围绕核心概念、流程和对比，而不是装饰",
            ],
            "recommended_preset": "hand-drawn-edu",
            "recommended_density": "balanced",
            "language": "zh-CN",
            "illustrations": [
                {
                    "position_heading": "",
                    "after_paragraph": 1,
                    "type": "infographic",
                    "purpose": "概括文章核心观点",
                    "visual_content": "中心主题与 3 个关键支撑点的手绘信息图",
                    "title": "核心观点总览",
                    "labels": ["核心观点", "关键概念", "行动路径"],
                    "slug": "core-overview",
                }
            ],
        }


class ImageProvider:
    def __init__(self, settings):
        self.settings = settings

    def generate(self, prompt, output_path, aspect_ratio="16:9"):
        provider = self.settings.get("image_provider")
        if provider == "mock":
            self._write_mock_png(output_path)
            return {"ok": True, "path": str(output_path)}
        if provider in ("openai", "openai-compatible"):
            return self._generate_openai(prompt, output_path)
        if provider == "codex-cli":
            return self._generate_codex_cli(prompt, output_path, aspect_ratio)
        if provider == "custom-command":
            return self._generate_custom(prompt, output_path, aspect_ratio)
        raise ProviderError(f"Unsupported image provider: {provider}")

    def test(self):
        provider = self.settings.get("image_provider")
        if provider == "mock":
            return {"ok": True, "message": "Mock image provider is available"}
        if provider in ("openai", "openai-compatible"):
            api_key_env = self.settings.get("image_api_key_env", "")
            if not os.environ.get(api_key_env):
                return {"ok": False, "message": f"Missing environment variable: {api_key_env}"}
            return {"ok": True, "message": "Image provider configuration looks valid"}
        if provider == "codex-cli":
            if shutil.which("codex"):
                return {"ok": True, "message": "codex CLI found"}
            return {"ok": False, "message": "codex CLI not found on PATH"}
        if provider == "custom-command":
            command = self.settings.get("custom_image_command", "")
            if not command:
                return {"ok": False, "message": "Custom command is empty"}
            return {"ok": True, "message": "Custom command is configured"}
        return {"ok": False, "message": f"Unsupported image provider: {provider}"}

    def _generate_openai(self, prompt, output_path):
        api_key = os.environ.get(self.settings.get("image_api_key_env", ""))
        if not api_key:
            raise ProviderError("Image API key environment variable is not available")

        base_url = self.settings.get("image_base_url", "https://api.openai.com/v1").rstrip("/")
        response = _post_json(
            f"{base_url}/images/generations",
            {
                "model": self.settings.get("image_model"),
                "prompt": prompt,
                "size": self.settings.get("image_size", "1536x1024"),
                "quality": self.settings.get("image_quality", "auto"),
                "n": 1,
            },
            api_key=api_key,
            timeout=self.settings.get("timeout_seconds", 120),
        )
        item = response.get("data", [{}])[0]
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if item.get("b64_json"):
            output_path.write_bytes(base64.b64decode(item["b64_json"]))
        elif item.get("url"):
            with urlrequest.urlopen(item["url"], timeout=self.settings.get("timeout_seconds", 120)) as image_response:
                output_path.write_bytes(image_response.read())
        else:
            raise ProviderError("Image provider returned no image")
        return {"ok": True, "path": str(output_path)}

    def _generate_codex_cli(self, prompt, output_path, aspect_ratio):
        raise ProviderError(
            "codex-cli image generation is not directly callable from this app yet. "
            "Use OpenAI-compatible or Custom Command provider."
        )

    def _generate_custom(self, prompt, output_path, aspect_ratio):
        command = self.settings.get("custom_image_command", "")
        if not command:
            raise ProviderError("Custom command is empty")
        prompt_path = Path(output_path).with_suffix(".prompt.txt")
        prompt_path.write_text(prompt, encoding="utf-8")
        env = os.environ.copy()
        env.update(
            {
                "PROMPT_FILE": str(prompt_path),
                "OUTPUT_FILE": str(output_path),
                "ASPECT_RATIO": aspect_ratio,
                "IMAGE_MODEL": self.settings.get("image_model", ""),
            }
        )
        subprocess.run(command, shell=True, check=True, env=env, timeout=self.settings.get("timeout_seconds", 120))
        if not Path(output_path).exists():
            raise ProviderError("Custom command completed but did not create output file")
        return {"ok": True, "path": str(output_path)}

    def _write_mock_png(self, output_path):
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        png_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAlgAAAGACAIAAAC7nTjcAAAGKklEQVR4nO3XMQ0AAAwCoNm/9HI83BLIOQrd"
            "YQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            "AAAAAAAAAAAAAAAAAAAAAHgYBYAAAf1WjWAAAAAASUVORK5CYII="
        )
        output_path.write_bytes(png_bytes)
