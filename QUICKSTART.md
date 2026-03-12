# Quick Reference: Deploy & Test AI Code Reviewer

## 1️⃣ Deploy to Azure (5 minutes)

### Windows (PowerShell)
```powershell
cd C:\path\to\ai-code-reviewer
.\deploy-prod.ps1 -SubscriptionId "YOUR_SUBSCRIPTION_ID"
```

### Linux/Mac (Bash)
```bash
cd /path/to/ai-code-reviewer
chmod +x deploy-prod.sh
./deploy-prod.sh "YOUR_SUBSCRIPTION_ID"
```

Output:
```
✅ Deployment complete.
📋 Outputs:
   AZURE_OPENAI_ENDPOINT=https://aoai-code-reviewer-prod.openai.azure.com
   AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini-prod
   LOG_ANALYTICS_WORKSPACE_ID=...
```

---

## 2️⃣ Get API Keys (2 minutes)

### Azure Portal → aoai-code-reviewer-prod
- Click "Keys and Endpoint"
- Copy **Key 1** → `AZURE_OPENAI_API_KEY` secret

### Azure Portal → law-code-reviewer-prod  
- Click "Agents management" (sidebar)
- Copy **Workspace ID** → `LOG_ANALYTICS_WORKSPACE_ID` secret
- Copy **Primary Key** → `LOG_ANALYTICS_SHARED_KEY` secret

---

## 3️⃣ Configure GitHub Repo (3 minutes)

### Settings → Secrets and Variables → Actions

**Add Secrets:**
```
AZURE_OPENAI_ENDPOINT = https://aoai-code-reviewer-prod.openai.azure.com
AZURE_OPENAI_API_KEY = <key from Azure>
LOG_ANALYTICS_WORKSPACE_ID = <from Azure>
LOG_ANALYTICS_SHARED_KEY = <key from Azure>
BILLING_ENDPOINT = https://billing.zerononsense.dev/license
```

**Add Variables:**
```
AZURE_OPENAI_DEPLOYMENT = gpt-4o-mini-prod
AZURE_OPENAI_API_VERSION = 2024-10-21
```

---

## 4️⃣ Test with PR (2 minutes)

```bash
# Create test branch
git checkout -b test/ai-review
echo "# Test" >> README.md
git add .
git commit -m "test: trigger AI reviewer"
git push origin test/ai-review

# Go to GitHub → Create Pull Request
# → Check Actions tab for workflow run
# → Verify PR comment with findings ✅
```

---

## 📊 Resource Overview

| Resource | Name | Type | Region |
|----------|------|------|--------|
| **Cognitive Services** | `aoai-code-reviewer-prod` | Azure OpenAI S0 | westeurope |
| **Monitoring** | `law-code-reviewer-prod` | Log Analytics | westeurope |
| **Resource Group** | `rg-code-reviewer-prod` | - | westeurope |

**Total Cost (Est.)**: ~$10-20/month (depends on usage)

---

## ✅ Validation Checklist

- [ ] `aoai-code-reviewer-prod` exists in Azure Portal
- [ ] `law-code-reviewer-prod` exists in Azure Portal
- [ ] All 5 secrets configured in GitHub
- [ ] Both variables configured in GitHub
- [ ] `.github/workflows/test-ai-reviewer.yml` exists in repo
- [ ] Test PR created and workflow triggered
- [ ] PR comments appear with findings ✅

---

## 🆘 Quick Troubleshoot

| Issue | Fix |
|-------|-----|
| Workflow doesn't trigger | Push `.github/workflows/test-ai-reviewer.yml` to default branch |
| 404 Azure error | Verify `AZURE_OPENAI_ENDPOINT` secret is correct |
| No findings in comment | Check action logs; verify billing endpoint auth |
| Unauthorized API key | Re-copy from Azure Portal |

---

## 📚 Full Docs
- [Deployment Guide](./DEPLOYMENT.md)
- [Marketplace Setup](./docs/marketplace.md)
- [README](./README.md)

---

**Ready?** Run step 1️⃣ above! 🚀
