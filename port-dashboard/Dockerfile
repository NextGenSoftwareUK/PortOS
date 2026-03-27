FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3120
ENV PORT_SITE=abidjan
ENV REFRESH_INTERVAL_SEC=60
ENV SIM_INTERVAL_SEC=12

EXPOSE 3120
CMD ["node", "server.mjs"]
