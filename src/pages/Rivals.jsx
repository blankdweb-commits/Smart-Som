import React from 'react';
import { Navigate } from 'react-router-dom';

/**
 * Rivals — a redirect into the social hub.
 *
 * Friends and Rivals were their own page until the hub landed. The logic now
 * lives in components/SocialPanel.jsx, which is rendered by the Friends and
 * Rivals tabs of /leaderboard, so this route exists only so the sidebar entry
 * and anyone's bookmark keep working.
 *
 * A `replace` redirect is deliberate: without it the back button walks
 * /leaderboard -> /rivals -> /leaderboard forever, because each navigation
 * pushes a new entry.
 */
const Rivals = () => <Navigate to="/leaderboard?tab=friends" replace />;

export default Rivals;
