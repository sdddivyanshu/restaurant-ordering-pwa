-- Separate databases for automated tests so they never touch development data.
CREATE DATABASE restaurant_test OWNER restaurant;
CREATE DATABASE restaurant_e2e OWNER restaurant;
