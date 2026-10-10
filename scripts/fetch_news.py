#!/usr/bin/env python3
"""BBC/Sky RSS -> static JSON on Pages (RSS feeds send no CORS headers, so phones can't fetch them directly).
Writes data/news.json (general + transfers) and data/clubnews/<espnTeamId>.json (club's own BBC feed)."""
import json, os, re, time, gzip, urllib.request, email.utils, datetime as dt, xml.etree.ElementTree as ET
UA = {'User-Agent': 'Mozilla/5.0 (pl-table-web data job; github.com/DannyG420/pl-table-web)', 'Accept-Encoding': 'gzip'}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
        b = r.read(); return gzip.decompress(b) if b[:2] == b'\x1f\x8b' else b
MEDIA = '{http://search.yahoo.com/mrss/}'
def rss(url, source):
    out = []
    for it in ET.fromstring(get(url)).iter('item'):
        g = lambda k: (it.findtext(k) or '').strip()
        img = None
        for tag in ('thumbnail', 'content'):
            e = it.find(MEDIA + tag)
            if e is not None and e.get('url'): img = e.get('url'); break
        if img is None:
            e = it.find('enclosure'); img = e.get('url') if e is not None else None
        try: d = email.utils.parsedate_to_datetime(g('pubDate')).astimezone(dt.timezone.utc).isoformat()
        except Exception: d = None
        if g('title') and g('link'):
            out.append({'title': g('title'), 'summary': re.sub('<[^>]+>', '', g('description'))[:300], 'url': g('link'), 'image': img, 'source': source, 'date': d})
    return out
def slug(n): return re.sub(r'[^a-z0-9]+', '-', n.lower().replace('&', 'and').replace('.', '').replace("'", '')).strip('-')
FEEDS = [('https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml', 'BBC Sport', 'latest'), ('https://www.skysports.com/rss/11661', 'Sky Sports', 'latest'),
         ('https://www.skysports.com/rss/12691', 'Sky Sports', 'transfers'), ('https://feeds.bbci.co.uk/sport/football/transfers/rss.xml', 'BBC Sport', 'transfers')]
os.makedirs('data/clubnews', exist_ok=True)
news = {'updated': dt.datetime.now(dt.timezone.utc).isoformat(), 'latest': [], 'transfers': []}
for url, src, kind in FEEDS:
    try: news[kind] += rss(url, src)
    except Exception as e: print('skip', url, e)
for k in ('latest', 'transfers'): news[k] = sorted(news[k], key=lambda x: x['date'] or '', reverse=True)[:80]
json.dump(news, open('data/news.json', 'w'), ensure_ascii=False, separators=(',', ':'))
n = 0
for lg in ('eng.1', 'eng.2', 'sco.1'):
    try: entries = json.loads(get(f'https://site.api.espn.com/apis/v2/sports/soccer/{lg}/standings'))['children'][0]['standings']['entries']
    except Exception as e: print('skip standings', lg, e); continue
    for e in entries:
        t = e['team']
        try:
            items = rss(f"https://feeds.bbci.co.uk/sport/football/teams/{slug(t['displayName'])}/rss.xml", 'BBC Sport')[:25]
            json.dump({'team': t['displayName'], 'items': items}, open(f"data/clubnews/{t['id']}.json", 'w'), ensure_ascii=False, separators=(',', ':')); n += 1
        except Exception as ex: print('skip club', t['displayName'], ex)
        time.sleep(0.3)
print('news', len(news['latest']), len(news['transfers']), 'clubs', n)
