#!/usr/bin/env python3
"""
Spotify Playlist Reader Module
Uses spotifyscraper to fetch public Spotify playlist metadata and tracks.
"""

import sys
import json
import re
import time
import argparse

try:
    from spotify_scraper import SpotifyClient, RateLimit, RetryPolicy
    from spotify_scraper.errors import NotFoundError, RateLimitedError, URLError, SpotifyScraperError
except ImportError as e:
    sys.stdout.write(json.dumps({
        "success": False,
        "error": "The 'spotifyscraper' library is not installed in Python.",
        "code": "DEPENDENCY_MISSING"
    }))
    sys.exit(1)


SPOTIFY_PLAYLIST_PATTERN = re.compile(
    r'(?:spotify(?:\.com)?(?:/(?:intl-[a-z]{2}|embed))?/playlist/|spotify:playlist:|^)([a-zA-Z0-9]{22})',
    re.IGNORECASE
)


def extract_playlist_id(url_or_id: str) -> str | None:
    """Extract 22-character Spotify playlist ID from URL, URI, or bare ID."""
    if not url_or_id:
        return None
    url_or_id = url_or_id.strip()
    match = SPOTIFY_PLAYLIST_PATTERN.search(url_or_id)
    if match:
        return match.group(1)
    return None


def select_best_image(images) -> str:
    """Pick a suitable image URL (prefer medium resolution ~300px or first available)."""
    if not images:
        return ""
    # Look for image with width closest to 300
    closest = None
    min_diff = float("inf")
    for img in images:
        if getattr(img, "width", None):
            diff = abs(img.width - 300)
            if diff < min_diff:
                min_diff = diff
                closest = img.url
        elif closest is None and getattr(img, "url", None):
            closest = img.url
    if closest:
        return closest
    return images[0].url if hasattr(images[0], "url") else str(images[0])


def fetch_playlist(playlist_id: str, max_tracks: int = 100, delay: float = 0.4) -> dict:
    """Fetch Spotify playlist tracks using spotifyscraper."""
    if delay > 0:
        time.sleep(delay)

    client = SpotifyClient(
        rate_limit=RateLimit(per_second=1.5, burst=2),
        retry=RetryPolicy(max_attempts=3, backoff_base=1.0)
    )

    try:
        playlist = client.get_playlist(playlist_id, max_tracks=max_tracks)
    except NotFoundError:
        return {
            "success": False,
            "error": "Spotify playlist not found or is private.",
            "code": "NOT_FOUND"
        }
    except RateLimitedError:
        return {
            "success": False,
            "error": "Spotify rate limit reached. Please wait a moment before trying again.",
            "code": "RATE_LIMITED"
        }
    except URLError:
        return {
            "success": False,
            "error": "Invalid Spotify playlist identifier or URL.",
            "code": "INVALID_URL"
        }
    except Exception as e:
        msg = str(e)
        if "unavailable" in msg.lower() or "not found" in msg.lower() or "404" in msg:
            return {
                "success": False,
                "error": "Spotify playlist not found or is private.",
                "code": "NOT_FOUND"
            }
        return {
            "success": False,
            "error": f"Failed to fetch Spotify playlist: {msg}",
            "code": "FETCH_ERROR"
        }

    playlist_cover = select_best_image(playlist.images)

    tracks = []
    for item in playlist.tracks:
        t = getattr(item, "track", None)
        if not t:
            continue

        artists = [a.name for a in t.artists] if getattr(t, "artists", None) else []
        artist_str = ", ".join(artists) if artists else "Unknown Artist"

        cover_img = ""
        if getattr(t, "images", None):
            cover_img = select_best_image(t.images)
        elif getattr(t, "album", None) and getattr(t.album, "images", None):
            cover_img = select_best_image(t.album.images)
        if not cover_img:
            cover_img = playlist_cover

        duration_ms = getattr(t, "duration_ms", 0) or 0
        duration_sec = round(duration_ms / 1000)

        album_name = getattr(t.album, "name", "") if getattr(t, "album", None) else ""

        tracks.append({
            "id": t.id,
            "title": t.name,
            "artist": artist_str,
            "artists": artists,
            "album": album_name,
            "cover": cover_img,
            "duration": duration_sec,
            "duration_ms": duration_ms,
            "source": "spotify",
            "query": f"{t.name} {artist_str}".strip()
        })

    return {
        "success": True,
        "id": playlist.id,
        "title": playlist.name or "Spotify Playlist",
        "description": getattr(playlist, "description", "") or "",
        "cover": playlist_cover,
        "total": getattr(playlist, "total_tracks", len(tracks)) or len(tracks),
        "source": "spotify",
        "tracks": tracks
    }


def main():
    parser = argparse.ArgumentParser(description="Fetch Spotify playlist tracks.")
    parser.add_argument("url", help="Spotify playlist URL, URI, or ID")
    parser.add_argument("--max-tracks", type=int, default=100, help="Maximum number of tracks")
    parser.add_argument("--delay", type=float, default=0.2, help="Inter-call delay in seconds")

    args = parser.parse_args()

    pid = extract_playlist_id(args.url)
    if not pid:
        sys.stdout.write(json.dumps({
            "success": False,
            "error": "Invalid Spotify playlist URL. Expected format: https://open.spotify.com/playlist/{id}",
            "code": "INVALID_URL"
        }))
        sys.exit(1)

    result = fetch_playlist(pid, max_tracks=args.max_tracks, delay=args.delay)
    sys.stdout.write(json.dumps(result))

    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
