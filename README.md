# Yateo Search

Un raccourci clavier, une fenêtre au-dessus de tout, et une recherche instantanée dans **Notion**, **Google Drive**, **Pipedrive**, vos **mails** (ouverts dans **Superhuman**), **ChatGPT** et **Claude**.

Application Windows légère (Tauri), pour usage personnel.

## Fonctionnalités

- **Raccourci global** (par défaut `Ctrl+Maj+Espace`), fenêtre toujours au premier plan, icône près de l'horloge.
- **Plusieurs barres de recherche** : une barre « Partout » et une barre par outil (`Alt+1` à `Alt+7`).
- **Résultats instantanés** grâce à un index local (titres et métadonnées seulement), complété à chaque frappe par une **recherche en direct** dans l'outil.
- **Autocomplétion dans la barre** : fin de titre proposée en gris (`Tab`) et suggestions de filtres, de valeurs et de contacts.
- **Filtres façon recherche native**, en pastilles ou au clavier (voir ci-dessous).
- **Liens directs vers les applications** : Notion, Superhuman et Claude s'ouvrent dans l'app quand elle est disponible, sinon dans le navigateur (réglable).
- **Toujours un bouton pour relancer la même recherche dans l'outil** (`Maj+Entrée`).
- Aperçu détaillé du résultat sélectionné, éléments fréquents remontés en tête, thème clair ou sombre.

## Raccourcis

| Touche | Action |
|---|---|
| `Ctrl+Maj+Espace` | Ouvrir / fermer (modifiable) |
| `Alt+1` … `Alt+7` | Partout, Notion, Drive, Pipedrive, Mails, ChatGPT, Claude |
| `↑` `↓` | Naviguer dans les résultats |
| `Tab` ou `→` | Accepter la suggestion grisée |
| `Entrée` | Ouvrir (dans l'app si disponible) |
| `Ctrl+Entrée` | Ouvrir dans le navigateur |
| `Maj+Entrée` | Relancer la recherche dans l'outil |
| `Ctrl+Maj+C` | Copier le lien |
| `Ctrl+R` | Synchroniser l'index |
| `Ctrl+,` | Paramètres |
| `Échap` | Effacer, puis revenir à l'accueil, puis fermer |

## Filtres disponibles

| Outil | Filtres |
|---|---|
| Notion | `type:page\|base` `par:` `modifié:7j` `dans:` `tri:recent` |
| Drive | `type:doc\|sheet\|slides\|pdf\|folder…` `proprio:moi` `modifié:30j` `est:suivi\|partage` `dossier:` |
| Pipedrive | `type:deal\|person\|organization\|lead\|product` `statut:open\|won\|lost` `étape:` `proprio:` `champ:email\|phone\|notes…` et les guillemets pour une recherche exacte |
| Mails | `de:` `à:` `cc:` `objet:` `avec:pj` `est:nonlu\|suivi` `dans:envoyés\|partout` `libellé:` `après:` `avant:` `récent:7d` `fichier:pdf` `taille:5M` `catégorie:`, ainsi que tous les opérateurs Gmail (`OR`, `-mot`, `"phrase exacte"`…) |
| ChatGPT / Claude | `modifié:` (historique importé) |

## Installation

1. Ouvrez l'onglet **Releases** du dépôt et téléchargez `Yateo.Search_x.y.z_x64-setup.exe`.
2. Lancez-le. Windows SmartScreen peut afficher un avertissement, car l'application n'est pas signée : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.
3. Au premier lancement, les paramètres s'ouvrent avec un guide pas à pas pour connecter chaque outil.

## Confidentialité

- Les clés d'accès sont stockées dans le **Gestionnaire d'identification Windows**, jamais dans un fichier ni dans ce dépôt.
- L'index local (dans `%APPDATA%\com.yateo.search`) ne contient que des titres et des métadonnées. Le contenu des pages, des fichiers et des mails n'est jamais stocké.
- Les accès Google sont en **lecture seule**.
- L'application ne peut contacter que `api.notion.com`, `*.pipedrive.com` et `*.googleapis.com`.

## Développement

```bash
npm install
npm run dev        # interface seule, en mode démo, dans le navigateur (http://localhost:1420)
npm run tauri dev  # application complète (Windows, avec Rust installé)
```

Pour publier une nouvelle version : augmentez `version` dans `src-tauri/tauri.conf.json` (et dans `src-tauri/Cargo.toml`), puis poussez sur `main`. GitHub compile automatiquement l'installateur et le publie dans Releases. Le workflow **Installateur Windows** peut aussi être lancé à la main depuis l'onglet Actions.
