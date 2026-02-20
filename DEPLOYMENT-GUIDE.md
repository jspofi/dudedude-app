# 🦦 DudeDude.app — Complete Deployment Guide
## (Zero experience? No problem. Follow every step exactly.)

---

## PART 1: CREATE A GITHUB ACCOUNT (skip if you have one)

1. Go to **https://github.com**
2. Click **"Sign Up"**
3. Enter email, password, username
4. Verify your email
5. Done ✅

---

## PART 2: UPLOAD YOUR CODE TO GITHUB

### Option A: Using GitHub Website (Easiest — no coding tools needed)

1. Go to **https://github.com/new**
2. Fill in:
   - Repository name: **`dudedude-app`**
   - Description: `Random video & text chat for guys`
   - Select: **Public**
   - ✅ Check "Add a README file"
3. Click **"Create repository"**
4. Now you need to upload the files. Click **"Add file"** → **"Upload files"**
5. **Drag and drop ALL these files/folders from the downloaded zip:**
   ```
   server.js
   package.json
   .gitignore
   public/          (folder with index.html + logo.png)
   admin/           (folder with index.html)
   ```
6. At the bottom, type commit message: `Initial commit`
7. Click **"Commit changes"**
8. Done! Your code is on GitHub ✅

### Option B: Using Command Line (if you have Git installed)

```bash
# Extract the zip file first, then:
cd dudedude-final

git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dudedude-app.git
git push -u origin main
```

---

## PART 3: DEPLOY TO RAILWAY (This runs your server 24/7)

### Why Railway and not Vercel?
> Vercel can't run WebSocket/Socket.io (needed for real-time chat).
> Railway can run everything — frontend + backend — from one repo.
> Free tier available. After that, ~$5/month.

### Steps:

1. Go to **https://railway.app**
2. Click **"Login"** → **"Login with GitHub"**
3. Authorize Railway to access your GitHub
4. Click **"New Project"** (big purple button)
5. Click **"Deploy from GitHub Repo"**
6. Select your **`dudedude-app`** repository
7. Railway will auto-detect it's a Node.js project ✅

### Set Environment Variables:

8. Click on your project → **"Variables"** tab
9. Click **"+ New Variable"** and add:

   | Key | Value |
   |-----|-------|
   | `ADMIN_KEY` | `your_secret_admin_password_here` |
   | `PORT` | `3000` |

   ⚠️ **Change `ADMIN_KEY` to something only YOU know!**

10. Click **"Deploy"** → Wait 1-2 minutes

### Get Your Live URL:

11. Go to **"Settings"** tab
12. Scroll to **"Networking"** section
13. Click **"Generate Domain"**
14. You'll get a URL like: `dudedude-app-production.up.railway.app`

### Test it:
- Main app: `https://dudedude-app-production.up.railway.app`
- Admin panel: `https://dudedude-app-production.up.railway.app/admin?key=your_secret_admin_password_here`

**🎉 YOUR APP IS NOW LIVE!**

---

## PART 4: CONNECT YOUR CUSTOM DOMAIN (dudedude.app)

### Step 1: Buy the domain (if not yet)
- Go to **https://domains.google.com** (or Namecheap, Cloudflare)
- Search for `dudedude.app`
- Buy it (~$14/year)

### Step 2: Add domain in Railway
1. In Railway project → **"Settings"** → **"Networking"**
2. Click **"+ Custom Domain"**
3. Type: `dudedude.app`
4. Railway will show you DNS records to add, something like:
   - Type: `CNAME`
   - Name: `@` or `dudedude.app`
   - Value: `dudedude-app-production.up.railway.app`

### Step 3: Update DNS at your domain registrar
1. Go to your domain registrar (Google Domains, Namecheap, etc.)
2. Go to **DNS Settings**
3. Add the CNAME record Railway gave you
4. Wait 5-30 minutes for DNS to propagate

### Step 4: SSL (HTTPS)
- Railway gives you **FREE SSL** automatically
- `.app` domains require HTTPS — Railway handles this ✅

### Done! Your app is live at `https://dudedude.app` 🎉

---

## PART 5: ADMIN PANEL GUIDE

### How to access:
```
https://dudedude.app/admin?key=YOUR_ADMIN_KEY
```

### What you'll see:
- **Connected**: Total users on the site right now
- **Chatting**: Users currently in a video/text chat
- **Pairs**: Number of active matched pairs
- **Waiting**: Users looking for a match
- **Idle**: Users on lobby/age gate
- **Total Ever**: All connections since server started

### Location tracking:
- **Users by Country** — bar chart showing which countries
- **Users by City** — bar chart showing which cities
- **User Table** — every connected user with:
  - Name, IP, Country, City, Status, Join Time

### Auto-refresh:
- Dashboard updates automatically every 3 seconds
- No need to manually refresh

---

## TROUBLESHOOTING

### "My site shows an error"
- Go to Railway → Click project → Check **"Logs"** for error messages
- Make sure `package.json` and `server.js` are in the ROOT of the repo (not inside a folder)

### "Camera doesn't work"
- Your site MUST be on HTTPS (Railway handles this)
- Some browsers block camera on non-HTTPS sites

### "Users can't connect to each other's video"
- This is a NAT/firewall issue. You need a TURN server for production
- For now, STUN servers (Google's free ones) work for ~70% of connections
- For 100% reliability, add a TURN server later (Metered.ca has free tier)

### "Admin panel won't load"
- Make sure the `key` parameter in the URL matches your `ADMIN_KEY` env variable exactly
- URL should be: `/admin?key=EXACT_KEY_HERE`

### "I want to update the code"
1. Edit files on GitHub (click file → pencil icon → edit → commit)
2. Railway auto-deploys in ~1 minute

---

## PROJECT STRUCTURE

```
dudedude-app/
├── server.js           ← Backend (Express + Socket.io + Admin API)
├── package.json        ← Dependencies
├── .gitignore          ← Ignore node_modules
├── public/
│   ├── index.html      ← Main app (age gate → lobby → chat)
│   └── logo.png        ← DudeDude logo
└── admin/
    └── index.html      ← Admin dashboard
```

## MONTHLY COST
| Service | Cost |
|---------|------|
| Railway (server) | Free → $5/mo |
| Domain (.app) | ~$14/year |
| SSL | Free (Railway) |
| STUN servers | Free (Google) |
| **TOTAL** | **~$5-6/month** |

---

## NEXT STEPS (After Launch)
1. 📌 Pin a tweet with link on your X account
2. 📊 Monitor admin panel for user count
3. 🔧 Add TURN server when you hit 50+ concurrent users
4. 💰 Add monetization when you hit 500+ concurrent
5. 📈 Track analytics (add Google Analytics later)
