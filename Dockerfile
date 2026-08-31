# ---- Stage 1: build the frontend ----
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: build the backend (frontend baked into Spring static resources) ----
FROM eclipse-temurin:25-jdk-alpine AS backend-build
WORKDIR /app/backend
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist/ src/main/resources/static/
RUN ./gradlew --no-daemon bootJar -x test

# ---- Stage 3: runtime ----
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=backend-build /app/backend/build/libs/*.jar app.jar
ENV TESLACAM_ROOT=/data
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]