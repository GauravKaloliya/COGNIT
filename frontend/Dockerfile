FROM node:18-slim

WORKDIR /app

COPY . .

RUN npm install

# Accept build argument for API base URL
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

RUN npm install -g serve

EXPOSE 10000

CMD ["sh", "-c", "serve -s dist -l $PORT"]
