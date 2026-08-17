import os
from pathlib import Path

# Default download directory — user's Music/YT-Downloads folder
DEFAULT_DOWNLOAD_DIR = str(Path.home() / "Music" / "YT-Downloads")

# Public base URL of the deployed service (scheme + host, no trailing slash).
# Set this in production, e.g. PUBLIC_BASE_URL=https://ytdlp.lan.hackinginstyle.com
# When empty, the app falls back to localhost dev URLs for the OAuth redirect.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")

# yt-dlp base options parsed from yt-dlp-arguments.txt (project root)
YT_DLP_BASE_OPTIONS: dict = {
    "ignoreerrors": True,
    "no_warnings": True,
    "concurrent_fragment_downloads": 4,

    # Bypass 403 Forbidden by forcing yt-dlp to use unblocked player clients
    "extractor_args": {
        "youtube": {
            "player_client": ["ios", "mweb", "web"]
        }
    },

    # Audio extraction — let yt-dlp pick the best available stream,
    # then FFmpeg converts it.  Do NOT set "format" here; an explicit
    # "bestaudio/best" fails for videos that only have muxed streams.
    "postprocessors": [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "320",
        },
        {
            "key": "FFmpegMetadata",
            "add_metadata": True,
        },
        {
            "key": "EmbedThumbnail",
            "already_have_thumbnail": False,
        },
    ],
    "writethumbnail": True,
    "convert_thumbnails": "jpg",
    # Filenames
    "restrictfilenames": True,
    "outtmpl": "%(title)s.%(ext)s",
    # Playlist
    "noplaylist": False,
    # User agent
    # "http_headers": {
    #     "User-Agent": (
    #         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    #         "AppleWebKit/537.36 (KHTML, like Gecko) "
    #         "Chrome/120.0.0.0 Safari/537.36"
    #     )
    # },
    # Suppress terminal output — we use progress hooks instead
    "quiet": True,
    "noprogress": True,
}
