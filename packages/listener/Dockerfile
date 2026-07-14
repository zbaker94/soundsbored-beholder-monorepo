# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (workspace build needs core + contract sources):
#   docker build -f packages/listener/Dockerfile -t soundsbored-listener .
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm -w @soundsbored/listener run build

FROM nginx:1.27-alpine
COPY packages/listener/nginx.conf /etc/nginx/conf.d/default.conf
COPY packages/listener/docker-entrypoint.d/40-config.sh /docker-entrypoint.d/40-config.sh
RUN chmod +x /docker-entrypoint.d/40-config.sh
COPY --from=build /app/packages/listener/dist /usr/share/nginx/html
EXPOSE 80
# nginx:alpine's entrypoint runs /docker-entrypoint.d/*.sh (regenerating config.js
# from LISTENER_* env) then launches nginx.
