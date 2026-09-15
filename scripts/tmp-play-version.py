import re
import urllib.request

url = "https://play.google.com/store/apps/details?id=ug.waka.pos&hl=en&gl=US"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
print("html_len", len(html))
print("has_1.0.12", "1.0.12" in html)

idx = html.find("1.0.12")
print("idx", idx)
if idx != -1:
    print("context", html[max(0, idx - 250) : idx + 250])

# Common Play Store embedded keys
for label, pat in [
    ("ds:5 version", r"\[\[\[\"1\.0\.12\",\[\[\[(\d+)\]\]\]"),
    ("near name", r"1\.0\.12\".{0,80}?(\d{1,6})"),
    ("versionCode key", r"versionCode\\u003d(\d+)"),
    ("play version code", r"\"versionCode\"\s*:\s*(\d+)"),
]:
    ms = re.findall(pat, html)
    print(label, ms[:10])

# Numbers that look like version codes near 1.0.12 occurrences
for m in re.finditer("1\\.0\\.12", html):
    chunk = html[max(0, m.start() - 120) : m.end() + 120]
    nums = re.findall(r"\b\d{1,6}\b", chunk)
    print("nums_near", nums, "chunk=", chunk.replace("\n", " ")[:240])
    break
