FROM node:20-alpine AS builder

WORKDIR /app

# Instala dependências
COPY package*.json ./

RUN npm set strict-ssl false
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

RUN npm install

# Copia o projeto
COPY . .

# Build da aplicação
RUN npm run build

# --- Serve with NGINX ---
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# copia sua configuração customizada
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]