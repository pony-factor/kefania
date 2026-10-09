"""Real Chromium smoke test against a GitHub-free local fixture server."""
import os
import shutil
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
server = subprocess.Popen(
    ["node", "test/browser-fixture-server.mjs"],
    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
)
try:
    url = server.stdout.readline().strip()
    assert url.startswith("http://127.0.0.1:"), "Fixture setup server did not start"
    with sync_playwright() as playwright:
        executable = next(
            (path for path in (shutil.which("chromium"), shutil.which("google-chrome"),
                               shutil.which("google-chrome-stable")) if path),
            None
        )
        browser = playwright.chromium.launch(
            headless=True, **({"executable_path": executable} if executable else {})
        )
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 920}, device_scale_factor=1)
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(url, wait_until="networkidle")
            expect(page.get_by_role("heading", name="Kefania")).to_be_visible()
            expect(page.get_by_role("heading", name="Choose where Kefania can work")).to_be_visible()
            expect(page.locator("#connection-state")).to_contain_text("gh CLI fallback")
            page.get_by_role("button", name="Connect GitHub").click()
            expect(page.locator("#auth-code")).to_have_text("ABCD-EFGH")
            expect(page.locator("#connection-state")).to_contain_text("sample-user", timeout=10000)
            expect(page.locator("#authorization")).to_be_hidden()
            assert page.locator("#repo-list input:disabled").count() == 1
            page.locator('#repo-list input[value="example/demo"]').check()
            page.locator("#default-repo").select_option("example/demo")
            page.locator("#length").select_option("concise")
            page.locator("#tone").select_option("formal")
            page.locator("#instructions").fill("Keep introductions short.")
            page.get_by_role("button", name="Save preferences").click()
            expect(page.locator("#save-message")).to_contain_text("Saved.")
            page.reload(wait_until="networkidle")
            expect(page.locator("#instructions")).to_have_value("Keep introductions short.")
            expect(page.locator("#length")).to_have_value("concise")
            expect(page.locator("#default-repo")).to_have_value("example/demo")
            page.locator("#head").fill("feature")
            page.get_by_role("button", name="Preview description").click()
            expect(page.locator("#pr-result")).to_contain_text("Preview-only description.")
            page.get_by_role("button", name="Publish ready-for-review PR").click()
            expect(page.locator("#pr-result")).to_contain_text("PR #42")
            assert not page.locator("#pr-result").inner_text().find("This PR description was written automatically.") >= 0
            page.screenshot(path=str(ARTIFACTS / "kefania-browser-smoke.png"), full_page=True)
            print("Chromium rendered setup, completed mock authorization, persisted settings, and previewed/published with fixtures.")
        finally:
            browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
