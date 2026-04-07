# Protège ton Claude Code en 5 minutes avec LLMask

> **TL;DR** — LLMask s'intercale entre Claude Code et l'API Anthropic. Il masque les données sensibles de ton code avant qu'elles ne quittent ta machine, puis les restaure dans la réponse. Transparent, configurable, zéro latence visible.

---

## 1. Pourquoi c'est important

Quand tu utilises **Claude Code**, **GitHub Copilot** ou **Codex CLI**, tout ce que tu envoies (ton code, tes noms de variables, tes clés API, tes noms de projets, les données de tes clients) transite en clair vers les serveurs du fournisseur LLM.

Concrètement, à chaque prompt tu peux exposer :

- des clés API et tokens (`STRIPE_SECRET_KEY`, `DATABASE_URL`…)
- des noms de clients ou de projets internes
- des schémas de base de données
- des adresses e-mail ou données PII
- des noms de domaines internes ou d'infrastructure

**LLMask** se pose en proxy local. Il intercepte chaque requête, remplace les données sensibles par des substituts neutres (`[EMAIL_1]`, `[API_KEY_2]`…), envoie le tout à l'API Anthropic, puis réinjecte les valeurs réelles dans la réponse — le tout en quelques millisecondes, de façon entièrement transparente pour Claude Code.

---

## 2. Installation

### Option A — npm (recommandé)

```bash
npm install -g llmask
```

Vérifie l'installation :

```bash
llmask --version
```

### Option B — Docker

```bash
docker run -d \
  --name llmask \
  -p 3456:3456 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/llmask/llmask:latest
```

---

## 3. Configuration initiale

Lance l'assistant de configuration :

```bash
llmask init
```

L'assistant te pose quatre questions :

```
? Fournisseur LLM cible › Anthropic          ← choisir Anthropic pour Claude Code
? Clé API Anthropic › sk-ant-...             ← ta clé sera stockée localement
? Stratégie de masquage › aggressive         ← recommandé : masque le maximum
? Port local › 3456                          ← laisse la valeur par défaut
```

> **Stratégies disponibles :**
> - `conservative` — masque uniquement les patterns évidents (clés, emails)
> - `balanced` — masque aussi les noms de projets et variables métier
> - `aggressive` — masque tout ce qui peut identifier ton code ou tes données (**recommandé**)

La configuration est sauvegardée dans `~/.llmaskrc`.

---

## 4. Pointer Claude Code vers LLMask

Claude Code utilise la variable d'environnement `ANTHROPIC_BASE_URL` pour savoir à quelle URL envoyer ses requêtes. Il suffit de la faire pointer vers ton proxy LLMask local.

### Option A — Variable d'environnement (session courante)

```bash
export ANTHROPIC_BASE_URL=http://localhost:3456
# Lance Claude Code normalement
claude
```

### Option B — Persistant dans la config Claude Code (recommandé)

Ajoute la variable dans `~/.claude/settings.json` pour qu'elle s'applique à toutes tes sessions :

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3456"
  }
}
```

> Le fichier `~/.claude/settings.json` est chargé automatiquement par Claude Code à chaque démarrage. Tu n'as plus rien à faire.

### Option C — Par projet uniquement

Pour n'activer LLMask que sur un projet spécifique, crée `.claude/settings.local.json` à la racine du projet (ce fichier est gitignored par défaut) :

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3456"
  }
}
```

### Option D — Profil shell (.bashrc / .zshrc)

```bash
echo 'export ANTHROPIC_BASE_URL=http://localhost:3456' >> ~/.zshrc
source ~/.zshrc
```

> **Note :** LLMask gère lui-même ta clé API Anthropic (configurée à l'étape 3). Tu n'as pas besoin de définir `ANTHROPIC_API_KEY` dans ton environnement — LLMask l'injecte dans chaque requête qu'il transmet.

---

## 5. Vérifier que tout fonctionne

Démarre LLMask (si ce n'est pas déjà fait) :

```bash
llmask start
```

Lance un test de bout en bout :

```bash
llmask test
```

Tu devrais voir une sortie similaire à :

```
LLMask Test — Anthropic / claude-sonnet-4-6
────────────────────────────────────────────
Prompt envoyé (après masquage) :
  "Mon email est [EMAIL_1] et ma clé est [API_KEY_1]. Explique ce code."

Réponse reçue (après restauration) :
  "Mon email est alice@acme.com et ma clé est sk-ant-abc123. ..."

Masquage OK ✓   Restauration OK ✓   Latence : 12ms
```

Ouvre ensuite Claude Code normalement :

```bash
claude
```

Dans le dashboard LLMask (`http://localhost:3456/dashboard`), tu verras en temps réel les prompts masqués et les statistiques de protection.

---

## 6. Conseils et personnalisation

### Règles spécifiques au projet — `.llmaskrc`

Crée un fichier `.llmaskrc` à la racine de ton projet pour ajouter des règles de masquage propres à ce dépôt :

```json
{
  "strategy": "aggressive",
  "rules": [
    { "pattern": "acme-corp", "replacement": "[CLIENT_NAME]" },
    { "pattern": "prod-db\\.internal", "replacement": "[DB_HOST]" },
    { "type": "jwt", "replacement": "[JWT_TOKEN]" }
  ],
  "exclude": [
    "*.test.ts",
    "fixtures/**"
  ]
}
```

LLMask charge automatiquement ce fichier si il se trouve dans le répertoire courant au moment du prompt.

### Surveiller les masquages en direct — `llmask watch`

```bash
llmask watch
```

Affiche en temps réel chaque requête interceptée, le texte masqué, et les tokens économisés.

### Couper le proxy rapidement

```bash
llmask stop
```

Pour revenir à l'API directe, retire ou commente `ANTHROPIC_BASE_URL` dans ta config, puis relance Claude Code.

---

## 7. Ce qui est protégé

LLMask détecte et masque automatiquement (avec la stratégie `aggressive`) :

| Catégorie | Exemples |
|---|---|
| Clés API & tokens | `sk-ant-...`, `ghp_...`, `AKIA...` (AWS), JWT |
| Identifiants de connexion | URLs `DATABASE_URL`, mots de passe dans les configs |
| Données personnelles (PII) | Adresses e-mail, numéros de téléphone, noms propres |
| Noms de projets & clients | Détectés par contexte ou règles `.llmaskrc` |
| Schémas de base de données | Noms de tables, colonnes, migrations |
| Variables d'environnement | Tout pattern `UPPER_SNAKE_CASE=valeur` |
| Adresses IP & hôtes internes | IP privées, domaines `.internal`, `.local` |
| Noms de branches & chemins | Chemins absolus révélant la structure interne |

> **Rappel :** les substituts (`[API_KEY_1]`, `[EMAIL_2]`…) sont cohérents au sein d'une même session — si la même valeur apparaît deux fois, elle reçoit le même substitut. Claude peut donc raisonner sur le code sans jamais voir les valeurs réelles.

---

## Ressources

- Documentation complète : [github.com/llmask/llmask](https://github.com/llmask/llmask)
- Dashboard local : [http://localhost:3456/dashboard](http://localhost:3456/dashboard)
- Signaler un problème : ouvre une issue sur le dépôt GitHub
