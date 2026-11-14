FROM node:24.22.3-alpine3.24

WORKDIR /app

COPY react-frontend/package*.json ./
RUN npm install --no-audit --no-fund

COPY react-frontend/. .

EXPOSE 5173

CMD ["npm", "run", "dev"]
