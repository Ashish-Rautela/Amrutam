terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "ap-south-1" # Mumbai region for Indian compliance
}

variable "environment" {
  default = "production"
}

# VPC and Networking
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "amrutam-vpc-${var.environment}"
    Environment = var.environment
  }
}

# RDS PostgreSQL Multi-AZ
resource "aws_db_instance" "postgres" {
  identifier             = "amrutam-pg-${var.environment}"
  engine                 = "postgres"
  engine_version         = "16.2"
  instance_class         = "db.t4g.large"
  allocated_storage      = 100
  max_allocated_storage  = 500
  storage_type           = "gp3"
  multi_az               = true
  db_name                = "amrutam_db"
  username               = "amrutam_admin"
  password               = var.db_password
  skip_final_snapshot    = false
  backup_retention_period = 30
  storage_encrypted      = true

  tags = {
    Name = "amrutam-database"
  }
}

variable "db_password" {
  type      = string
  sensitive = true
}
