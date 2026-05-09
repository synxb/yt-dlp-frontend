import os
from pathlib import Path

# Default download directory — user's Music/YT-Downloads folder
DEFAULT_DOWNLOAD_DIR = str(Path.home() / "Music" / "YT-Downloads")

# yt-dlp base options parsed from yt-dlp-arguments.txt (project root)
YT_DLP_BASE_OPTIONS: dict = {
    "ignoreerrors": True,
    "no_warnings": True,
    "concurrent_fragment_downloads": 4,
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
    "http_headers": {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    },
    # Suppress terminal output — we use progress hooks instead
    "quiet": True,
    "noprogress": True,
}
