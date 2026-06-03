FROM node:18-bullseye-slim

# Install packages required by Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    xdg-utils \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
  --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install Chromium
RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Prevent Puppeteer from downloading Chromium during npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Provide a default executable path for Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production
COPY . .

# Ensure a default session dir (Render persistent disk is usually mounted at /opt/render/data)
ENV SESSION_DIR=/opt/render/data/whatsapp-session
RUN mkdir -p $SESSION_DIR

EXPOSE 3000
CMD ["npm", "start"]
