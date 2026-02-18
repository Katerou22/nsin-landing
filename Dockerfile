FROM node:22-alpine

WORKDIR /app

COPY server.js .
COPY index.html public/
COPY assets/ public/assets/

EXPOSE 8080
CMD ["node", "server.js"]
