CREATE DATABASE IF NOT EXISTS id_life
	CHARACTER SET utf8mb4
	COLLATE utf8mb4_unicode_ci;

USE id_life;

CREATE TABLE users (
	id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	public_id CHAR(10) NOT NULL UNIQUE,
	dob_hash VARCHAR(255) NOT NULL,
	first_name VARCHAR(100) NOT NULL,
	last_name VARCHAR(100) NOT NULL,
	faculty VARCHAR(150),
	major VARCHAR(150),
	bio VARCHAR(255),
	latitude DECIMAL(10, 7),
	longitude DECIMAL(10, 7),
	location_visibility_tier TINYINT UNSIGNED NOT NULL DEFAULT 2,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE daily_tasks (
	id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT UNSIGNED NOT NULL,
	task_name VARCHAR(255) NOT NULL,
	task_date DATE NOT NULL,
	is_completed BOOLEAN NOT NULL DEFAULT 0,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	completed_at DATETIME NULL,
	INDEX (user_id, task_date),
	FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE friendships (
	id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT UNSIGNED NOT NULL,
	friend_id BIGINT UNSIGNED NOT NULL,
	status ENUM('pending', 'accepted', 'rejected', 'blocked') NOT NULL DEFAULT 'pending',
	closeness_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	accepted_at DATETIME NULL,
	UNIQUE KEY pair_key (user_id, friend_id),
	FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY (friend_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE sessions (
	id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT UNSIGNED NOT NULL,
	session_token_hash CHAR(64) NOT NULL UNIQUE,
	expires_at DATETIME NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	revoked_at DATETIME NULL,
	FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE friend_requests (
	id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
	sender_id BIGINT UNSIGNED NOT NULL,
	receiver_id BIGINT UNSIGNED NOT NULL,
	status ENUM('pending', 'accepted', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	responded_at DATETIME NULL,
	FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY (receiver_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Production: hash/verify DOB on server (Argon2id/bcrypt); do not store plaintext DOB. Prefer a stronger second factor for real authentication.
