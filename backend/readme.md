# Collaborative Editor API

## Authentication
All endpoints except `/api/auth/*` require a JWT token in the Authorization header.

## API Endpoints

### Auth Endpoints
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Document Endpoints
- `GET /api/documents` - Get user's documents
- `POST /api/documents` - Create a new document
- `GET /api/documents/:id` - Get a specific document
- `PUT /api/documents/:id` - Update a document
- `DELETE /api/documents/:id` - Delete a document
- `POST /api/documents/:id/collaborators` - Add a collaborator
- `DELETE /api/documents/:id/collaborators/:userId` - Remove a collaborator

## WebSocket Events
- `join-document` - Join a document room
- `cursor-move` - Send cursor position
- `leave-document` - Leave a document room