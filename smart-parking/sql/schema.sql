-- User Table
CREATE TABLE IF NOT EXISTS USER (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(15) NOT NULL,
  password_hash VARCHAR(255) NOT NULL
);
-- SPLIT
-- Vehicle Table
CREATE TABLE IF NOT EXISTS VEHICLE (
  vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_number VARCHAR(20) NOT NULL UNIQUE,
  vehicle_type ENUM('2W','4W','Heavy') NOT NULL,
  user_id INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES USER(user_id) ON DELETE CASCADE
);
-- SPLIT
-- Parking Lot Table
CREATE TABLE IF NOT EXISTS PARKING_LOT (
  lot_id INT AUTO_INCREMENT PRIMARY KEY,
  floor_no INT NOT NULL,
  slot_no INT NOT NULL,
  slot_type ENUM('2W','4W','Heavy') NOT NULL,
  zone ENUM('Gate','Middle','Far') NOT NULL DEFAULT 'Middle',
  slot_status ENUM('Available','Locked','Occupied') DEFAULT 'Available',
  locked_until DATETIME DEFAULT NULL,
  locked_by_booking INT DEFAULT NULL,
  UNIQUE (floor_no, slot_no)
);
-- SPLIT
-- Booking Table
CREATE TABLE IF NOT EXISTS BOOKING (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  lot_id INT NOT NULL,
  booking_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  booking_status ENUM('Locked','Active','Completed','Cancelled','Expired') DEFAULT 'Locked',
  lock_expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES USER(user_id),
  FOREIGN KEY (vehicle_id) REFERENCES VEHICLE(vehicle_id),
  FOREIGN KEY (lot_id) REFERENCES PARKING_LOT(lot_id)
);
-- SPLIT
-- Payment Table
CREATE TABLE IF NOT EXISTS PAYMENT (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNIQUE,
  entry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  exit_time DATETIME,
  duration DECIMAL(6,2),
  amount DECIMAL(10,2),
  payment_method ENUM('Cash','UPI','Card') DEFAULT 'UPI',
  payment_status ENUM('Pending','Paid') DEFAULT 'Pending',
  FOREIGN KEY (booking_id) REFERENCES BOOKING(booking_id)
);
-- SPLIT
-- Admin Table
CREATE TABLE IF NOT EXISTS ADMIN (
  admin_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  age INT NOT NULL CHECK (age >= 18)
);
-- SPLIT
-- Manages Table
CREATE TABLE IF NOT EXISTS MANAGES (
  admin_id INT,
  lot_id INT,
  PRIMARY KEY (admin_id, lot_id),
  FOREIGN KEY (admin_id) REFERENCES ADMIN(admin_id),
  FOREIGN KEY (lot_id) REFERENCES PARKING_LOT(lot_id)
);
-- SPLIT
-- Insert Seed Data for PARKING_LOT (3 floors, 10 slots each)
-- Using IGNORE to prevent duplicate errors on restart
INSERT IGNORE INTO PARKING_LOT (floor_no, slot_no, slot_type, zone, slot_status) VALUES
(1, 1, '2W', 'Gate', 'Available'), (1, 2, '2W', 'Gate', 'Available'), (1, 3, '4W', 'Middle', 'Available'), (1, 4, '4W', 'Middle', 'Available'), (1, 5, '4W', 'Middle', 'Available'), (1, 6, '4W', 'Far', 'Available'), (1, 7, 'Heavy', 'Far', 'Available'), (1, 8, 'Heavy', 'Gate', 'Available'), (1, 9, '2W', 'Middle', 'Available'), (1, 10, '2W', 'Far', 'Available'),
(2, 1, '4W', 'Gate', 'Available'), (2, 2, '4W', 'Gate', 'Available'), (2, 3, '4W', 'Middle', 'Available'), (2, 4, '4W', 'Middle', 'Available'), (2, 5, '4W', 'Far', 'Available'), (2, 6, '2W', 'Far', 'Available'), (2, 7, '2W', 'Middle', 'Available'), (2, 8, '2W', 'Gate', 'Available'), (2, 9, 'Heavy', 'Far', 'Available'), (2, 10, 'Heavy', 'Middle', 'Available'),
(3, 1, '2W', 'Middle', 'Available'), (3, 2, '2W', 'Far', 'Available'), (3, 3, '4W', 'Gate', 'Available'), (3, 4, '4W', 'Middle', 'Available'), (3, 5, '4W', 'Far', 'Available'), (3, 6, 'Heavy', 'Gate', 'Available'), (3, 7, 'Heavy', 'Middle', 'Available'), (3, 8, 'Heavy', 'Far', 'Available'), (3, 9, '2W', 'Gate', 'Available'), (3, 10, '4W', 'Middle', 'Available');
-- SPLIT
-- View: Available Slots
CREATE OR REPLACE VIEW vw_available_slots AS
SELECT pl.lot_id, pl.floor_no, pl.slot_no, pl.slot_type, pl.zone,
  CASE 
    WHEN pl.slot_type = '2W' THEN 15.00
    WHEN pl.slot_type = '4W' THEN 40.00
    WHEN pl.slot_type = 'Heavy' THEN 80.00
  END + 
  CASE 
    WHEN pl.zone = 'Gate' THEN 20.00
    WHEN pl.zone = 'Middle' THEN 0.00
    WHEN pl.zone = 'Far' THEN -10.00
  END AS min_charge
FROM PARKING_LOT pl
WHERE pl.slot_status = 'Available';
-- SPLIT


-- View: Active Bookings
CREATE OR REPLACE VIEW vw_active_bookings AS
SELECT b.booking_id, b.user_id, b.vehicle_id, v.vehicle_number, v.vehicle_type,
  pl.floor_no, pl.slot_no, pl.zone, b.booking_status, b.lock_expires_at,
  p.entry_time, p.payment_status
FROM BOOKING b
JOIN VEHICLE v ON b.vehicle_id = v.vehicle_id
JOIN PARKING_LOT pl ON b.lot_id = pl.lot_id
LEFT JOIN PAYMENT p ON b.booking_id = p.booking_id
WHERE b.booking_status IN ('Locked','Active');
-- SPLIT


DROP FUNCTION IF EXISTS fn_calculate_duration;
-- SPLIT
CREATE FUNCTION fn_calculate_duration(p_entry DATETIME, p_exit DATETIME) RETURNS DECIMAL(6,2)
DETERMINISTIC
BEGIN
  DECLARE v_hours DECIMAL(6,2);
  SET v_hours = TIMESTAMPDIFF(MINUTE, p_entry, p_exit) / 60.0;
  IF v_hours < 1.0 THEN
    SET v_hours = 1.0;
  END IF;
  RETURN v_hours;
END;
-- SPLIT


DROP FUNCTION IF EXISTS fn_calculate_amount;
-- SPLIT
-- Base rates: 2W: 15, 4W: 40, Heavy: 80. 
-- Zone surcharge (flat): Gate: +20, Middle: +0, Far: -10
CREATE FUNCTION fn_calculate_amount(p_duration DECIMAL(6,2), p_vehicle_type VARCHAR(10), p_zone VARCHAR(10)) RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
  DECLARE v_base_rate DECIMAL(10,2);
  DECLARE v_surcharge DECIMAL(10,2);
  DECLARE v_total DECIMAL(10,2);
  
  -- Prevent duration less than 1 hour billing
  IF p_duration < 1.0 THEN
    SET p_duration = 1.0;
  END IF;

  IF p_vehicle_type = '2W' THEN SET v_base_rate = 15.00;
  ELSEIF p_vehicle_type = '4W' THEN SET v_base_rate = 40.00;
  ELSEIF p_vehicle_type = 'Heavy' THEN SET v_base_rate = 80.00;
  ELSE SET v_base_rate = 40.00;
  END IF;
  
  IF p_zone = 'Gate' THEN SET v_surcharge = 20.00;
  ELSEIF p_zone = 'Middle' THEN SET v_surcharge = 0.00;
  ELSEIF p_zone = 'Far' THEN SET v_surcharge = -10.00;
  ELSE SET v_surcharge = 0.00;
  END IF;
  
  SET v_total = (p_duration * v_base_rate) + v_surcharge;
  RETURN v_total;
END;
-- SPLIT


DROP PROCEDURE IF EXISTS sp_book_slot;
-- SPLIT
CREATE PROCEDURE sp_book_slot(IN p_user_id INT, IN p_vehicle_id INT, IN p_lot_id INT, OUT p_booking_id INT)
BEGIN
  -- We set booking status 'Locked', locked_until = NOW() + 2 MIN, lock expires 2 MIN.
  -- The trigger AFTER INSERT will handle updating the PARKING_LOT slot status.
  INSERT INTO BOOKING (user_id, vehicle_id, lot_id, booking_time, booking_status, lock_expires_at)
  VALUES (p_user_id, p_vehicle_id, p_lot_id, NOW(), 'Locked', DATE_ADD(NOW(), INTERVAL 2 MINUTE));
  
  SET p_booking_id = LAST_INSERT_ID();
  
  INSERT INTO PAYMENT (booking_id, payment_status)
  VALUES (p_booking_id, 'Pending');
END;
-- SPLIT


DROP PROCEDURE IF EXISTS sp_confirm_payment;
-- SPLIT
CREATE PROCEDURE sp_confirm_payment(IN p_booking_id INT, IN p_payment_method VARCHAR(10))
BEGIN
  -- Triggers will handle lot status to Occupied via booking update
  UPDATE BOOKING 
  SET booking_status = 'Active' 
  WHERE booking_id = p_booking_id AND booking_status = 'Locked';
  
  UPDATE PAYMENT 
  SET payment_status = 'Paid', payment_method = p_payment_method, entry_time = NOW()
  WHERE booking_id = p_booking_id;
END;
-- SPLIT


DROP PROCEDURE IF EXISTS sp_record_exit;
-- SPLIT
CREATE PROCEDURE sp_record_exit(IN p_booking_id INT)
BEGIN
  DECLARE v_entry_time DATETIME;
  DECLARE v_vehicle_type VARCHAR(10);
  DECLARE v_zone VARCHAR(10);
  DECLARE v_duration DECIMAL(6,2);
  DECLARE v_amount DECIMAL(10,2);
  
  SELECT p.entry_time, v.vehicle_type, pl.zone 
  INTO v_entry_time, v_vehicle_type, v_zone
  FROM BOOKING b
  JOIN VEHICLE v ON b.vehicle_id = v.vehicle_id
  JOIN PARKING_LOT pl ON b.lot_id = pl.lot_id
  JOIN PAYMENT p ON b.booking_id = p.booking_id
  WHERE b.booking_id = p_booking_id;
  
  SET v_duration = fn_calculate_duration(v_entry_time, NOW());
  SET v_amount = fn_calculate_amount(v_duration, v_vehicle_type, v_zone);
  
  UPDATE PAYMENT
  SET exit_time = NOW(), duration = v_duration, amount = v_amount, payment_status = 'Paid'
  WHERE booking_id = p_booking_id;
  
  UPDATE BOOKING
  SET booking_status = 'Completed'
  WHERE booking_id = p_booking_id;
  -- After UPDATE trigger handles lot status
END;
-- SPLIT


DROP PROCEDURE IF EXISTS sp_expire_locks;
-- SPLIT
CREATE PROCEDURE sp_expire_locks()
BEGIN
  UPDATE BOOKING
  SET booking_status = 'Expired'
  WHERE lock_expires_at < NOW() AND booking_status = 'Locked';
  -- Trigger handles the lot status cleanup
END;
-- SPLIT
DROP PROCEDURE IF EXISTS sp_floor_occupancy_report;
-- SPLIT
CREATE PROCEDURE sp_floor_occupancy_report()
BEGIN
  SELECT floor_no, 
         SUM(CASE WHEN slot_status = 'Available' THEN 1 ELSE 0 END) AS available_count,
         SUM(CASE WHEN slot_status = 'Locked' THEN 1 ELSE 0 END) AS locked_count,
         SUM(CASE WHEN slot_status = 'Occupied' THEN 1 ELSE 0 END) AS occupied_count
  FROM PARKING_LOT
  GROUP BY floor_no
  ORDER BY floor_no ASC;
END;
-- SPLIT


DROP PROCEDURE IF EXISTS sp_get_user_total_spent;
-- SPLIT
CREATE PROCEDURE sp_get_user_total_spent(IN p_user_id INT, OUT p_total DECIMAL(10,2))
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO p_total
  FROM PAYMENT p
  JOIN BOOKING b ON p.booking_id = b.booking_id
  WHERE b.user_id = p_user_id AND p.payment_status = 'Paid' AND p.amount IS NOT NULL;
END;
-- SPLIT
DROP TRIGGER IF EXISTS trg_after_booking_insert;
-- SPLIT
CREATE TRIGGER trg_after_booking_insert
AFTER INSERT ON BOOKING
FOR EACH ROW
BEGIN
  IF NEW.booking_status = 'Locked' THEN
    UPDATE PARKING_LOT 
    SET slot_status = 'Locked', 
        locked_until = NEW.lock_expires_at, 
        locked_by_booking = NEW.booking_id
    WHERE lot_id = NEW.lot_id;
  END IF;
END;
-- SPLIT


DROP TRIGGER IF EXISTS trg_after_booking_update;
-- SPLIT
CREATE TRIGGER trg_after_booking_update
AFTER UPDATE ON BOOKING
FOR EACH ROW
BEGIN
  IF NEW.booking_status = 'Active' AND OLD.booking_status != 'Active' THEN
    UPDATE PARKING_LOT 
    SET slot_status = 'Occupied', locked_until = NULL
    WHERE lot_id = NEW.lot_id;
  ELSEIF NEW.booking_status IN ('Completed', 'Cancelled', 'Expired') AND OLD.booking_status NOT IN ('Completed', 'Cancelled', 'Expired') THEN
    UPDATE PARKING_LOT 
    SET slot_status = 'Available', locked_until = NULL, locked_by_booking = NULL
    WHERE lot_id = NEW.lot_id;
  END IF;
END;
-- SPLIT


-- CURSOR PROCEDURE: Auto-Recommend Best Slot
DROP PROCEDURE IF EXISTS sp_recommend_best_slot;
-- SPLIT
CREATE PROCEDURE sp_recommend_best_slot(IN p_vehicle_type VARCHAR(10), OUT p_best_lot_id INT)
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE v_lot_id INT;
  DECLARE v_cost DECIMAL(10,2);
  
  DECLARE v_lowest_cost DECIMAL(10,2) DEFAULT 9999.99;
  DECLARE v_best_lot INT DEFAULT NULL;
  
  -- Declare Cursor for matching available slots via the Pricing View
  DECLARE cur_slots CURSOR FOR 
    SELECT lot_id, min_charge 
    FROM vw_available_slots 
    WHERE slot_type = p_vehicle_type;
    
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
  
  OPEN cur_slots;
  
  eval_loop: LOOP
    FETCH cur_slots INTO v_lot_id, v_cost;
    IF done THEN
      LEAVE eval_loop;
    END IF;
    
    -- Track the absolute cheapest slot during cursor iteration
    IF v_cost < v_lowest_cost THEN
      SET v_lowest_cost = v_cost;
      SET v_best_lot = v_lot_id;
    END IF;
  END LOOP;
  
  CLOSE cur_slots;
  
  SET p_best_lot_id = v_best_lot;
END;
