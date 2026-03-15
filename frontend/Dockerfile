# Stage 1: Build the frontend
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency files for layer caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy source and build
COPY . .

# No VITE_API_BASE_URL needed — nginx proxies /api to backend
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
