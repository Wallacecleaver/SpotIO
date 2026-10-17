# SpotIO

Addon Stremio qui met **ton Spotify** dans Stremio : tes playlists, albums, titres likés, top titres, écoutes récentes, nouveautés et une recherche. Spotify fournit le catalogue, **YouTube fournit la lecture** (Spotify ne donne aucun flux audio exploitable hors de ses propres lecteurs).

## Fonctionnement

- Playlists, albums et nouveautés sont des **channels** (la liste des titres s’affiche comme des vidéos). Les titres likés, top et récents sont des **movies** (un clic, un play).
- Pour chaque titre, SpotIO cherche la meilleure vidéo YouTube (artiste, titre, durée, chaîne « Topic », malus live/cover/remix…) et renvoie jusqu’à 3 candidats en `ytId`.
- Aucune base de données utilisateur : le refresh token Spotify est **chiffré (AES-256-GCM)** dans l’URL de l’addon. Le cache des matchs YouTube est un simple fichier JSON.
- Dashboard (`/dashboard`) : stats, derniers matchs avec miniatures, correction manuelle d’un match, erreurs, vidage du cache.

## Installation

1. Crée une app sur <https://developer.spotify.com/dashboard> et ajoute la Redirect URI `<BASE_URL>/auth/callback`.
2. `cp .env.example .env`, remplis les variables (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `BASE_URL`, `SECRET`, `ADMIN_KEY`).
3. `npm install && npm start`, puis ouvre `/configure`.

### Déploiement

- **VPS / Oracle / OVH** (recommandé, le cache persiste) : `docker build -t spotio . && docker run -d -p 7000:7000 -v spotio:/data --env-file .env spotio`, derrière un reverse proxy HTTPS.
- **Vercel** : importe le repo, définis les variables d’environnement. Le cache est alors dans `/tmp` (éphémère).

## Limites à connaître

- Mode « development » de Spotify : seuls les comptes ajoutés dans le dashboard Spotify peuvent se connecter (25 max). Certains endpoints ont aussi été restreints pour les nouvelles apps ; vérifie la doc Spotify si un catalogue reste vide (les erreurs apparaissent dans le dashboard).
- Le scraping YouTube peut être bloqué depuis certaines IP de datacenter : renseigne `YT_API_KEY` (YouTube Data API v3) pour plus de fiabilité.
- La lecture `ytId` passe par le lecteur YouTube de Stremio : c’est de la vidéo, et le support dépend de la plateforme.
