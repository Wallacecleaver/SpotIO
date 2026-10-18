# SpotIO

Addon Stremio qui met **ton Spotify** dans Stremio : tes playlists, albums, titres likés, top titres, écoutes récentes, nouveautés et une recherche. Spotify fournit le catalogue, **YouTube fournit la lecture** (Spotify ne donne aucun flux audio exploitable hors de ses propres lecteurs).

## Fonctionnement

- Playlists, albums et nouveautés sont des **channels** (la liste des titres s’affiche comme des vidéos). Les titres likés, top et récents sont des **movies** (un clic, un play).
- **Recherche du titre** : chaîne de secours API YouTube (si `YT_API_KEY`) → scraping YouTube → Piped → Invidious. Chaque candidat est noté (artiste, titre, durée, chaîne « Topic », malus live/cover/remix…).
- **Lecture** : SpotIO propose d’abord un **flux audio direct** (Piped, puis Invidious, avec proxy de l’instance), puis jusqu’à 3 flux YouTube (`ytId`) en repli. Le mode se choisit dans `/configure`.
- Aucune base de données utilisateur : le refresh token Spotify est **chiffré (AES-256-GCM)** dans l’URL de l’addon. Le cache des matchs YouTube est un simple fichier JSON.
- Dashboard (`/dashboard`) : stats, derniers matchs avec miniatures, correction manuelle d’un match, erreurs, vidage du cache.

## Deux modes de catalogue

- **Liens de playlists (recommandé, sans compte)** : colle des liens de playlists/albums **Spotify** (publics) ou **Deezer** dans `/configure`. Les titres sont lus depuis la page embed publique de Spotify (100 titres max environ par liste) ou l’API publique de Deezer (300 max). Ni app Spotify Developer ni Premium nécessaires. Si Spotify change le format de sa page embed, l’import Spotify peut casser : le dashboard et la prévisualisation de `/configure` l’indiquent.
- **Compte Spotify (optionnel)** : titres likés, top, récents, recherche Spotify, etc. Depuis février 2026, la Web API exige que le propriétaire de l’app soit **Premium**, et le mode développement est limité à 5 utilisateurs.

Dans les deux cas, la **recherche YouTube** est disponible comme catalogue.

## Installation

1. *(Mode compte Spotify uniquement)* Crée une app sur <https://developer.spotify.com/dashboard> (nom ne commençant pas par « Spot ») et ajoute la Redirect URI `<BASE_URL>/auth/callback`.
2. `cp .env.example .env`, remplis les variables (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `BASE_URL`, `SECRET`, `ADMIN_KEY`).
3. `npm install && npm start`, puis ouvre `/configure`.

### Déploiement

- **VPS / Oracle / OVH** (recommandé, le cache persiste) : `docker build -t spotio . && docker run -d -p 7000:7000 -v spotio:/data --env-file .env spotio`, derrière un reverse proxy HTTPS.
- **Vercel** : importe le repo, définis les variables d’environnement. Le cache est alors dans `/tmp` (éphémère).

## Sources audio (Piped / Invidious)

Les instances sont découvertes automatiquement (liste publique de Piped et d’Invidious), testées en parallèle, et mises de côté 5 min si elles échouent. Les instances publiques sont instables : pour de meilleurs résultats, renseigne tes propres instances ou des instances fiables dans `PIPED_INSTANCES` / `INVIDIOUS_INSTANCES` (URLs séparées par des virgules). L’état des instances est visible dans le dashboard.

## Limites à connaître

- Mode « development » de Spotify : seuls les comptes ajoutés dans le dashboard Spotify peuvent se connecter (5 max depuis février 2026). Certains endpoints ont aussi été restreints pour les nouvelles apps ; vérifie la doc Spotify si un catalogue reste vide (les erreurs apparaissent dans le dashboard).
- Le scraping YouTube peut être bloqué depuis certaines IP de datacenter : renseigne `YT_API_KEY` (YouTube Data API v3) pour plus de fiabilité.
- La lecture `ytId` passe par le lecteur YouTube de Stremio : c’est de la vidéo, et le support dépend de la plateforme.
