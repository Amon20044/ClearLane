FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
# API base is baked at build time; the browser reaches the backend on localhost:8000
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback so #/dispatch routes and refreshes work
RUN printf 'server {\n listen 80;\n location / {\n  root /usr/share/nginx/html;\n  try_files $uri /index.html;\n }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
