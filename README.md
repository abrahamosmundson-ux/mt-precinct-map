# Montana Precinct Map

Where Montana Young Republicans can serve: every voting precinct in Montana, its committeeman and committeewoman seats, and which ones are open.

**Live site:** https://abrahamosmundson-ux.github.io/mt-precinct-map/

## What it does

- Address search (Montana State Library address locator), "Near me" location, and town/precinct/district search
- County, House and Senate district lines
- Seat status for all 1,456 precinct committee seats, live from Supabase
- "I want to serve here" sign-ups from the public
- Chair login: approved editors mark seats and keep private prospect notes

## Files

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The site |
| `config.js` | Supabase project URL and anon key (both public by design) |
| `data/precincts.json` | 728 precincts from the Montana State Library (Montana Voting Precincts) |
| `data/lines.json` | County, House and Senate lines, built from the precincts |

## Adding a chair (editor)

1. Supabase → Authentication → Users → Add user → Create new user (check Auto Confirm).
2. Supabase → SQL Editor:

```sql
insert into public.editors (email) values ('chair@example.com');
```

To remove someone: `delete from public.editors where email = 'chair@example.com';`

## Updating precinct boundaries

Download fresh GeoJSON from the Montana State Library precinct layer (MapServer/10, `outSR=4326`, `f=geojson`), replace `data/precincts.json`, and rebuild `data/lines.json`.
