#!/usr/bin/env python3
"""Fetch FotMob ratings / predicted line-ups into static JSON served same-origin by GitHub Pages
(FotMob blocks cross-origin requests from real phone browsers). Usage: fetch_fotmob.py ratings|lineups"""
import json, sys, time, gzip, urllib.request, datetime as dt
UA = {'User-Agent': 'Mozilla/5.0 (pl-table-web data job; github.com/DannyG420/pl-table-web)', 'Accept': 'application/json', 'Accept-Encoding': 'gzip'}
def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                b = r.read()
                if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
                return json.loads(b)
        except Exception as e:
            err = e; time.sleep(2 + i * 3)
    raise err
now = dt.datetime.now(dt.timezone.utc)
def ratings():
    lg = get('https://www.fotmob.com/api/data/leagues?id=47')
    links = {l['Name']: l['RelativePath'].rsplit('/', 1)[0] + '/' for l in lg['stats']['seasonStatLinks']}
    out = {'updated': now.isoformat(), 'source': 'FotMob', 'seasons': {}}
    for name, path in list(links.items())[:3]:  # current + 2 previous seasons
        try:
            d = get('https://data.fotmob.com/' + path + 'rating.json')
            out['seasons'][name.split('/')[0]] = [{'rank': x.get('Rank') or i + 1, 'id': x.get('ParticiantId') or x.get('ParticipantId'), 'name': x['ParticipantName'],
                'team': x.get('TeamName'), 'rating': x['StatValue'], 'apps': x.get('MatchesPlayed'), 'mins': x.get('MinutesPlayed')}
                for i, x in enumerate(d['TopLists'][0]['StatList'][:50])]
        except Exception as e: print('skip', name, e)
        time.sleep(1)
    if not out['seasons']: sys.exit('no ratings fetched')
    json.dump(out, open('data/ratings.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('ratings seasons', list(out['seasons']))
LEAGUES = {'eng.1': 47, 'eng.2': 48, 'sco.1': 64, 'uefa.champions': 42, 'eng.fa': 132}
def team(t):
    st = (t or {}).get('starters') or []
    if len(st) < 11: return None
    return {'formation': t.get('formation'),
            'players': [{'name': p.get('name'), 'num': str(p.get('shirtNumber') or ''), 'x': (p.get('verticalLayout') or {}).get('x', .5), 'y': (p.get('verticalLayout') or {}).get('y', .5)} for p in st],
            'unavailable': [u.get('name', '') + (f" ({u['unavailability']['type']})" if (u.get('unavailability') or {}).get('type') else '') for u in t.get('unavailable') or []]}
def lineups():
    out = {'updated': now.isoformat(), 'source': 'FotMob', 'matches': []}
    for slug, lid in LEAGUES.items():
        try: ms = get(f'https://www.fotmob.com/api/data/leagues?id={lid}')['fixtures']['allMatches']
        except Exception as e: print('skip league', slug, e); continue
        for m in ms:
            st = m.get('status') or {}
            if st.get('started') or st.get('finished') or st.get('cancelled'): continue
            try: t = dt.datetime.fromisoformat(st['utcTime'].replace('Z', '+00:00'))
            except Exception: continue
            if t > now + dt.timedelta(days=14): continue
            try:
                l = get(f"https://www.fotmob.com/api/data/matchDetails?matchId={m['id']}").get('content', {}).get('lineup') or {}
            except Exception as e: print('skip match', m['id'], e); continue
            h, a = team(l.get('homeTeam')), team(l.get('awayTeam'))
            if h or a:
                out['matches'].append({'league': slug, 'id': m['id'], 'utc': st['utcTime'], 'home': m['home']['name'], 'away': m['away']['name'],
                                       'type': l.get('lineupType'), 'h': h, 'a': a})
            time.sleep(0.7)
    json.dump(out, open('data/lineups.json', 'w'), ensure_ascii=False, separators=(',', ':'))
    print('lineups', len(out['matches']))
{'ratings': ratings, 'lineups': lineups}[sys.argv[1]]()
