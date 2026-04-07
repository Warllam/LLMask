# Guide de déploiement LLMask — Production

**Durée estimée : 20-30 minutes**

Ce guide s'adresse à un administrateur système souhaitant déployer LLMask sur un serveur Linux. LLMask s'installe comme un proxy HTTPS entre vos outils (VS Code, Cursor, Claude Code, etc.) et l'API de votre fournisseur LLM. Il masque automatiquement les données sensibles avant qu'elles quittent votre réseau.

---

## Prérequis

- Un serveur Linux (Ubuntu 22.04 LTS recommandé) avec au minimum :
  - 1 vCPU, 1 Go de RAM
  - 10 Go d'espace disque
- **Docker** et **Docker Compose** v2 installés ([guide officiel](https://docs.docker.com/engine/install/ubuntu/))
- Un nom de domaine pointant vers votre serveur (ex. `llmask.monentreprise.com`)
- Les ports 80 et 443 ouverts dans votre pare-feu
- Une clé API valide pour votre fournisseur LLM (OpenAI, Anthropic, etc.)

### Vérification des prérequis

```bash
docker --version        # Docker version 24.x ou supérieur
docker compose version  # Docker Compose version v2.x
```

---

## Étape 1 — Cloner le dépôt

```bash
git clone https://github.com/your-org/llmask.git /opt/llmask
cd /opt/llmask
```

---

## Étape 2 — Configurer l'environnement

Copiez le fichier d'exemple et renseignez vos valeurs :

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env   # ou vim, selon votre préférence
```

Les variables **indispensables** à renseigner :

| Variable | Description | Exemple |
|---|---|---|
| `LLMASK_DOMAIN` | Votre domaine public | `llmask.monentreprise.com` |
| `PRIMARY_PROVIDER` | Fournisseur LLM | `openai` |
| `OPENAI_API_KEY` | Clé API OpenAI | `sk-...` |

> **Astuce sécurité :** Pour générer une clé admin solide :
> ```bash
> openssl rand -hex 32
> ```
> Copiez le résultat dans `LLMASK_ADMIN_KEY` et passez `LLMASK_AUTH_ENABLED=true`.

---

## Étape 3 — Construire et démarrer

```bash
# Construire l'image LLMask (première fois : 3-5 minutes)
docker compose -f docker-compose.prod.yml --env-file deploy/.env build

# Démarrer tous les services en arrière-plan
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d
```

Vérifiez que les conteneurs tournent :

```bash
docker compose -f docker-compose.prod.yml ps
```

Vous devriez voir `llmask` et `caddy` avec le statut `healthy`.

---

## Étape 4 — Vérifier que tout fonctionne

### Santé du service

```bash
curl https://llmask.monentreprise.com/health
# Réponse attendue : {"status":"ok","uptime":...}
```

### Test de masquage

Envoyez une requête test avec des données fictives sensibles :

```bash
curl -X POST https://llmask.monentreprise.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Mon email est john.doe@test.com, résume en une phrase."}]
  }'
```

Dans les logs, vous verrez que l'email a été remplacé avant d'atteindre OpenAI :

```bash
docker logs llmask --tail 20
```

### Tableau de bord

Ouvrez `https://llmask.monentreprise.com` dans un navigateur pour accéder au tableau de bord.

---

## Étape 5 — Pointer vos outils vers le proxy

Remplacez l'URL de base OpenAI/Anthropic par votre domaine LLMask dans chaque outil :

**Cursor / VS Code (Copilot)**
- Paramètre : `openai.baseUrl` → `https://llmask.monentreprise.com/v1`

**Claude Code**
```bash
export ANTHROPIC_BASE_URL=https://llmask.monentreprise.com
```

**Python / LangChain**
```python
import openai
client = openai.OpenAI(
    base_url="https://llmask.monentreprise.com/v1",
    api_key="votre-clé-api"
)
```

**n8n / Make**
- Dans le nœud OpenAI, renseignez `Base URL` → `https://llmask.monentreprise.com/v1`

---

## Sauvegarde

Les données persistantes (base SQLite avec les mappings de masquage) sont stockées dans le volume Docker `llmask-data`. Pour sauvegarder :

```bash
# Sauvegarde manuelle
docker run --rm \
  -v llmask-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/llmask-$(date +%Y%m%d).tar.gz -C /data .
```

Pour une sauvegarde automatique quotidienne via cron :

```bash
crontab -e
# Ajouter la ligne :
0 2 * * * docker run --rm -v llmask-data:/data -v /opt/llmask/backups:/backup alpine tar czf /backup/llmask-$(date +\%Y\%m\%d).tar.gz -C /data . 2>/dev/null
```

---

## Maintenance

### Mettre à jour LLMask

```bash
cd /opt/llmask
git pull

# Reconstruire et redémarrer (zéro downtime : Caddy continue de servir)
docker compose -f docker-compose.prod.yml --env-file deploy/.env build llmask
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --no-deps llmask
```

### Consulter les logs

```bash
# Logs en temps réel
docker logs -f llmask

# Logs Caddy (accès HTTPS)
docker logs -f caddy
```

### Redémarrer un service

```bash
docker compose -f docker-compose.prod.yml restart llmask
```

### Arrêter complètement

```bash
docker compose -f docker-compose.prod.yml down
# Les volumes (données) sont conservés. Pour tout supprimer :
# docker compose -f docker-compose.prod.yml down -v
```

---

## Résolution de problèmes

| Symptôme | Cause probable | Solution |
|---|---|---|
| Caddy refuse de démarrer | Port 80/443 occupé | `ss -tlnp \| grep ':80\|:443'` puis arrêter le processus |
| Certificat HTTPS non obtenu | DNS pas encore propagé | Attendez 5-10 min, vérifiez avec `dig llmask.monentreprise.com` |
| `llmask` en état `unhealthy` | Mauvaise config `.env` | `docker logs llmask` pour voir l'erreur |
| Requêtes bloquées (429) | Rate limit atteint | Augmenter `LLMASK_RATE_LIMIT` dans `.env` |
| Timeout provider | Clé API invalide ou quota dépassé | Vérifier la clé dans `.env` |

---

## Sécurité supplémentaire (recommandé)

1. **Activer l'authentification du tableau de bord** : `LLMASK_AUTH_ENABLED=true` + `LLMASK_ADMIN_KEY=<clé forte>`
2. **Restreindre les origines CORS** : `CORS_ORIGINS=https://monoutil.monentreprise.com`
3. **Activer les métriques Prometheus avec token** : `METRICS_AUTH_TOKEN=<token>` pour éviter l'exposition publique
4. **Pare-feu** : Bloquer les ports 8787 au niveau réseau (seul Caddy doit y accéder en interne)
